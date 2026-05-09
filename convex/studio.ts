import { v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";

const KIND = v.union(v.literal("explain"), v.literal("prove"), v.literal("fix"));

export const upsertRunning = internalMutation({
  args: {
    scanId: v.id("scans"),
    findingId: v.id("findings"),
    kind: KIND,
  },
  handler: async (ctx, { scanId, findingId, kind }) => {
    const existing = await ctx.db
      .query("remediations")
      .withIndex("by_finding_kind", (q) => q.eq("findingId", findingId).eq("kind", kind))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "running",
        error: undefined,
        startedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("remediations", {
      scanId,
      findingId,
      kind,
      status: "running",
      startedAt: Date.now(),
    });
  },
});

export const writeResult = internalMutation({
  args: {
    findingId: v.id("findings"),
    kind: KIND,
    payload: v.object({
      explainMarkdown: v.optional(v.string()),
      codeSnippet: v.optional(v.string()),
      proofKind: v.optional(v.string()),
      proofContent: v.optional(v.string()),
      patchUnifiedDiff: v.optional(v.string()),
      fixSummary: v.optional(v.string()),
      fixBody: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { findingId, kind, payload }) => {
    const row = await ctx.db
      .query("remediations")
      .withIndex("by_finding_kind", (q) => q.eq("findingId", findingId).eq("kind", kind))
      .first();
    if (!row) return;
    await ctx.db.patch(row._id, {
      ...payload,
      status: "done",
      finishedAt: Date.now(),
    });
  },
});

export const writeError = internalMutation({
  args: {
    findingId: v.id("findings"),
    kind: KIND,
    error: v.string(),
  },
  handler: async (ctx, { findingId, kind, error }) => {
    const row = await ctx.db
      .query("remediations")
      .withIndex("by_finding_kind", (q) => q.eq("findingId", findingId).eq("kind", kind))
      .first();
    if (!row) return;
    await ctx.db.patch(row._id, {
      status: "error",
      error,
      finishedAt: Date.now(),
    });
  },
});

export const byFinding = query({
  args: { findingId: v.id("findings") },
  handler: async (ctx, { findingId }) => {
    const rows = await ctx.db
      .query("remediations")
      .withIndex("by_finding_kind", (q) => q.eq("findingId", findingId))
      .collect();
    const byKind: Record<string, (typeof rows)[number]> = {};
    for (const r of rows) byKind[r.kind] = r;
    return {
      explain: byKind.explain ?? null,
      prove: byKind.prove ?? null,
      fix: byKind.fix ?? null,
    };
  },
});

export const topThreeFindingIds = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_scan", (q) => q.eq("scanId", scanId))
      .collect();
    return rows
      .filter((f) => f.reducerKept === true && f.reducerRank !== undefined)
      .sort((a, b) => (a.reducerRank ?? 999) - (b.reducerRank ?? 999))
      .slice(0, 3)
      .map((f) => f._id);
  },
});

export const getFinding = internalQuery({
  args: { findingId: v.id("findings") },
  handler: async (ctx, { findingId }) => {
    const finding = await ctx.db.get(findingId);
    if (!finding) return null;
    const scan = await ctx.db.get(finding.scanId);
    return {
      finding,
      repoUrl: scan?.repoUrl,
      clonedSha: scan?.clonedSha,
    };
  },
});

const KIND_TO_ACTION = {
  explain: internal.studio_actions.generateExplain,
  prove: internal.studio_actions.generateProve,
  fix: internal.studio_actions.generateFix,
} as const;

export const ensure = action({
  args: {
    findingId: v.id("findings"),
    kind: KIND,
  },
  handler: async (ctx, { findingId, kind }): Promise<void> => {
    const existing = await ctx.runQuery(internal.studio.getRemediation, { findingId, kind });
    if (existing && (existing.status === "done" || existing.status === "running")) {
      return;
    }
    await ctx.scheduler.runAfter(0, KIND_TO_ACTION[kind], { findingId });
  },
});

export const getRemediation = internalQuery({
  args: { findingId: v.id("findings"), kind: KIND },
  handler: async (ctx, { findingId, kind }) => {
    return await ctx.db
      .query("remediations")
      .withIndex("by_finding_kind", (q) => q.eq("findingId", findingId).eq("kind", kind))
      .first();
  },
});
