import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

export const start = mutation({
  args: { repoUrl: v.string() },
  handler: async (ctx, { repoUrl }) => {
    const scanId = await ctx.db.insert("scans", {
      repoUrl,
      status: "pending",
      totalAgents: 0,
      completedAgents: 0,
      startedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.orchestrator.run, { scanId });
    return scanId;
  },
});

export const get = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => await ctx.db.get(scanId),
});

export const setStatus = internalMutation({
  args: {
    scanId: v.id("scans"),
    status: v.union(
      v.literal("pending"),
      v.literal("cloning"),
      v.literal("scanning"),
      v.literal("reducing"),
      v.literal("done"),
      v.literal("error"),
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { scanId, status, error }) => {
    const patch: any = { status };
    if (error) patch.error = error;
    if (status === "done" || status === "error") patch.finishedAt = Date.now();
    await ctx.db.patch(scanId, patch);
  },
});

export const setTotalAgents = internalMutation({
  args: { scanId: v.id("scans"), total: v.number() },
  handler: async (ctx, { scanId, total }) => {
    await ctx.db.patch(scanId, { totalAgents: total });
  },
});

export const setClonedSha = internalMutation({
  args: { scanId: v.id("scans"), sha: v.string() },
  handler: async (ctx, { scanId, sha }) => {
    await ctx.db.patch(scanId, { clonedSha: sha });
  },
});

export const bumpProgress = internalMutation({
  args: {
    scanId: v.id("scans"),
    cacheKind: v.optional(
      v.union(v.literal("hit"), v.literal("miss")),
    ),
  },
  handler: async (ctx, { scanId, cacheKind }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return;
    const completed = scan.completedAgents + 1;
    // Single patch folds the per-agent counters together so 20 parallel auditors
    // hit the scan doc once each instead of twice (cache bump + progress bump).
    // Halves OCC contention on the scans row.
    const patch: any = { completedAgents: completed };
    if (cacheKind === "hit") patch.cacheHits = (scan.cacheHits ?? 0) + 1;
    if (cacheKind === "miss") patch.cacheMisses = (scan.cacheMisses ?? 0) + 1;
    if (
      completed >= scan.totalAgents &&
      scan.totalAgents > 0 &&
      !scan.dedupStartedAt
    ) {
      patch.status = "reducing";
      patch.dedupStartedAt = Date.now();
    }
    await ctx.db.patch(scanId, patch);
    if (patch.dedupStartedAt) {
      await ctx.scheduler.runAfter(0, internal.dedup.run, { scanId });
    }
  },
});
