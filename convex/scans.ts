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

export const bumpProgress = internalMutation({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return;
    const completed = scan.completedAgents + 1;
    await ctx.db.patch(scanId, { completedAgents: completed });
    if (completed >= scan.totalAgents && scan.totalAgents > 0) {
      await ctx.db.patch(scanId, { status: "reducing" });
      await ctx.scheduler.runAfter(0, internal.reducer.run, { scanId });
    }
  },
});
