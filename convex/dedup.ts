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
