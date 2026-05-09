"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import OpenAI from "openai";
import {
  runExplainGenerator,
  runProveGenerator,
  runFixGenerator,
} from "./studio_generators";
import type { OpenAIClient } from "./studio_generators";
import { fetchSnippet } from "./repo";
import type { FindingForPrompt } from "./studio_prompts";

const STUDIO_MODEL = "gpt-4o-mini";

function makeClient(): OpenAIClient {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return {
    async complete(prompt, maxTokens) {
      const res = await openai.chat.completions.create({
        model: STUDIO_MODEL,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
      });
      return res.choices[0]?.message?.content ?? "{}";
    },
  };
}

async function loadSnippet(
  repoUrl: string | undefined,
  sha: string | undefined,
  finding: { file: string; lineStart: number; lineEnd: number; evidence: string },
  padding: number,
): Promise<string> {
  if (repoUrl && sha) {
    const fetched = await fetchSnippet(repoUrl, sha, finding.file, finding.lineStart, finding.lineEnd, padding);
    if (fetched) return fetched;
  }
  return finding.evidence;
}

function toFindingForPrompt(f: any): FindingForPrompt {
  return {
    angle: f.angle,
    file: f.file,
    lineStart: f.lineStart,
    lineEnd: f.lineEnd,
    severity: f.severity,
    title: f.title,
    description: f.description,
    evidence: f.evidence,
  };
}

export const generateExplain = internalAction({
  args: { findingId: v.id("findings") },
  handler: async (ctx, { findingId }) => {
    const data = await ctx.runQuery(internal.studio.getFinding, { findingId });
    if (!data || !data.finding) return;
    const { finding, repoUrl, clonedSha } = data;
    await ctx.runMutation(internal.studio.upsertRunning, {
      scanId: finding.scanId,
      findingId,
      kind: "explain",
    });
    try {
      const snippet = await loadSnippet(repoUrl, clonedSha, finding, 10);
      const result = await runExplainGenerator(toFindingForPrompt(finding), snippet, makeClient());
      await ctx.runMutation(internal.studio.writeResult, {
        findingId,
        kind: "explain",
        payload: {
          explainMarkdown: result.explainMarkdown,
          codeSnippet: snippet,
        },
      });
    } catch (err: any) {
      await ctx.runMutation(internal.studio.writeError, {
        findingId,
        kind: "explain",
        error: err?.message ?? String(err),
      });
    }
  },
});

export const generateProve = internalAction({
  args: { findingId: v.id("findings") },
  handler: async (ctx, { findingId }) => {
    const data = await ctx.runQuery(internal.studio.getFinding, { findingId });
    if (!data || !data.finding) return;
    const { finding, repoUrl, clonedSha } = data;
    await ctx.runMutation(internal.studio.upsertRunning, {
      scanId: finding.scanId,
      findingId,
      kind: "prove",
    });
    try {
      const snippet = await loadSnippet(repoUrl, clonedSha, finding, 10);
      const result = await runProveGenerator(toFindingForPrompt(finding), snippet, makeClient());
      await ctx.runMutation(internal.studio.writeResult, {
        findingId,
        kind: "prove",
        payload: {
          proofKind: result.proofKind,
          proofContent: result.proofContent,
        },
      });
    } catch (err: any) {
      await ctx.runMutation(internal.studio.writeError, {
        findingId,
        kind: "prove",
        error: err?.message ?? String(err),
      });
    }
  },
});

export const generateFix = internalAction({
  args: { findingId: v.id("findings") },
  handler: async (ctx, { findingId }) => {
    const data = await ctx.runQuery(internal.studio.getFinding, { findingId });
    if (!data || !data.finding) return;
    const { finding, repoUrl, clonedSha } = data;
    await ctx.runMutation(internal.studio.upsertRunning, {
      scanId: finding.scanId,
      findingId,
      kind: "fix",
    });
    try {
      const snippet = await loadSnippet(repoUrl, clonedSha, finding, 20);
      const result = await runFixGenerator(toFindingForPrompt(finding), snippet, makeClient());
      await ctx.runMutation(internal.studio.writeResult, {
        findingId,
        kind: "fix",
        payload: {
          patchUnifiedDiff: result.patchUnifiedDiff,
          fixSummary: result.fixSummary,
          fixBody: result.fixBody,
        },
      });
    } catch (err: any) {
      await ctx.runMutation(internal.studio.writeError, {
        findingId,
        kind: "fix",
        error: err?.message ?? String(err),
      });
    }
  },
});
