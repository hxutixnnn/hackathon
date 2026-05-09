"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import OpenAI from "openai";
import { cosine, UnionFind, lineRangesOverlap } from "./lib/cluster";
import { corpusFor } from "./lib/eval";

const COSINE_THRESHOLD = 0.85;
const LINE_SLACK = 5;
const EMBED_MODEL = "text-embedding-3-small";
const MAX_INPUTS = 2048;

function buildRerankPrompt(
  reps: { _id: string; angle: string; file: string; lineStart: number; lineEnd: number; title: string; description: string; severity: number }[],
): string {
  const items = reps
    .map(
      (r) =>
        `id=${r._id} angle=${r.angle} ${r.file}:${r.lineStart}-${r.lineEnd} sev=${r.severity}\n  ${r.title}`,
    )
    .join("\n");
  return `You are reranking ${reps.length} security findings by exploitability and impact.
Return JSON: {"ranked": [{"id": "...", "rank": <1-based>, "severity": <1-10>}]}.
Lower rank = more critical. Severity may be adjusted up or down by 1-2 from the input.

Findings:
${items}`;
}

export const run = internalAction({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    try {
      const scan = await ctx.runQuery(internal.scans_internal.getInternal, {
        scanId,
      });
      if (!scan) return;

      const findings = await ctx.runQuery(
        internal.scans_internal.findingsForReducer,
        { scanId },
      );

      if (findings.length === 0 || findings.length > MAX_INPUTS) {
        await markAllKept(ctx, findings);
        await runEvalAndFinish(ctx, scanId, scan.repoUrl);
        return;
      }

      const inputs = findings.map(
        (f: any) =>
          `${f.angle}|${f.file}:${f.lineStart}-${f.lineEnd}|${f.title}\n${f.description}`,
      );

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      let embeddings: number[][];
      try {
        const res = await openai.embeddings.create({
          model: EMBED_MODEL,
          input: inputs,
        });
        embeddings = res.data.map((d) => d.embedding);
      } catch (err) {
        console.error("embed failed, keeping all", err);
        await markAllKept(ctx, findings);
        await runEvalAndFinish(ctx, scanId, scan.repoUrl);
        return;
      }

      const uf = new UnionFind(findings.length);
      for (let i = 0; i < findings.length; i++) {
        for (let j = i + 1; j < findings.length; j++) {
          if (findings[i].file !== findings[j].file) continue;
          if (
            !lineRangesOverlap(
              findings[i].lineStart,
              findings[i].lineEnd,
              findings[j].lineStart,
              findings[j].lineEnd,
              LINE_SLACK,
            )
          )
            continue;
          if (cosine(embeddings[i], embeddings[j]) >= COSINE_THRESHOLD) {
            uf.union(i, j);
          }
        }
      }

      const clusters = uf.groups();
      const reps: { id: string; severity: number }[] = [];
      const dropped: string[] = [];

      for (const cluster of clusters) {
        const sorted = [...cluster].sort((a, b) => {
          const sa = findings[a].severity;
          const sb = findings[b].severity;
          if (sa !== sb) return sb - sa;
          return findings[a].title.length - findings[b].title.length;
        });
        const repIdx = sorted[0];
        reps.push({
          id: findings[repIdx]._id,
          severity: findings[repIdx].severity,
        });
        for (let k = 1; k < sorted.length; k++) {
          dropped.push(findings[sorted[k]]._id);
        }
      }

      await ctx.runMutation(internal.dedup_mutations.applyClusters, {
        keptIds: reps.map((r) => r.id),
        droppedIds: dropped,
      });

      const top = reps
        .sort((a, b) => b.severity - a.severity)
        .slice(0, 30);

      if (top.length > 0) {
        try {
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          const repFindings = top.map((r) => findings.find((f: any) => f._id === r.id)!);
          const prompt = buildRerankPrompt(repFindings);
          const res = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            messages: [{ role: "user", content: prompt }],
            max_tokens: 1500,
          });
          const text = res.choices[0]?.message?.content ?? "{}";
          const parsed = JSON.parse(text);
          const ranks = (parsed.ranked ?? [])
            .filter(
              (r: any) =>
                typeof r?.id === "string" &&
                typeof r?.rank === "number" &&
                typeof r?.severity === "number",
            )
            .map((r: any) => ({
              id: r.id,
              rank: r.rank,
              severity: Math.max(1, Math.min(10, Math.round(r.severity))),
            }));
          if (ranks.length > 0) {
            await ctx.runMutation(internal.dedup_mutations.applyRerank, { ranks });
          }
        } catch (err) {
          console.error("rerank failed, keeping raw severity ranks", err);
        }
      }

      await runEvalAndFinish(ctx, scanId, scan.repoUrl);
    } catch (err: any) {
      await ctx.runMutation(internal.scans.setStatus, {
        scanId,
        status: "error",
        error: err?.message ?? String(err),
      });
    }
  },
});

async function markAllKept(
  ctx: any,
  findings: { _id: string }[],
): Promise<void> {
  await ctx.runMutation(internal.dedup_mutations.applyClusters, {
    keptIds: findings.map((f) => f._id),
    droppedIds: [],
  });
}

async function runEvalAndFinish(
  ctx: any,
  scanId: any,
  repoUrl: string,
): Promise<void> {
  if (corpusFor(repoUrl)) {
    await ctx.runAction(internal.eval.score, { scanId });
  }
  await ctx.runMutation(internal.scans.setStatus, { scanId, status: "done" });
}
