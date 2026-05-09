import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const lookup = internalQuery({
  args: { cacheKey: v.string() },
  handler: async (ctx, { cacheKey }) => {
    const row = await ctx.db
      .query("findingCache")
      .withIndex("by_key", (q) => q.eq("cacheKey", cacheKey))
      .unique();
    return row?.findings ?? null;
  },
});

export const put = internalMutation({
  args: {
    cacheKey: v.string(),
    angleId: v.string(),
    chunkHash: v.string(),
    model: v.string(),
    promptVer: v.string(),
    findings: v.array(
      v.object({
        file: v.string(),
        lineStart: v.number(),
        lineEnd: v.number(),
        severity: v.number(),
        title: v.string(),
        description: v.string(),
        evidence: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("findingCache")
      .withIndex("by_key", (q) => q.eq("cacheKey", args.cacheKey))
      .unique();
    if (existing) return;
    await ctx.db.insert("findingCache", { ...args, createdAt: Date.now() });
  },
});

export const bumpHit = internalMutation({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return;
    await ctx.db.patch(scanId, { cacheHits: (scan.cacheHits ?? 0) + 1 });
  },
});

export const bumpMiss = internalMutation({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return;
    await ctx.db.patch(scanId, { cacheMisses: (scan.cacheMisses ?? 0) + 1 });
  },
});
