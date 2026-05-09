import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

export const byScan = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    return await ctx.db
      .query("findings")
      .withIndex("by_scan", (q) => q.eq("scanId", scanId))
      .collect();
  },
});

export const countsByAngle = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_scan", (q) => q.eq("scanId", scanId))
      .collect();
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.angle] = (counts[r.angle] ?? 0) + 1;
    return counts;
  },
});

export const insertMany = internalMutation({
  args: {
    scanId: v.id("scans"),
    angle: v.string(),
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
  handler: async (ctx, { scanId, angle, findings }) => {
    for (const f of findings) {
      await ctx.db.insert("findings", { ...f, scanId, angle });
    }
  },
});

export const applyReducer = internalMutation({
  args: {
    scanId: v.id("scans"),
    consolidated: v.array(
      v.object({
        rawIds: v.array(v.string()),
        severity: v.number(),
        rank: v.number(),
      }),
    ),
    discardedIds: v.array(v.string()),
  },
  handler: async (ctx, { scanId, consolidated, discardedIds }) => {
    for (const id of discardedIds) {
      try {
        await ctx.db.patch(id as any, { reducerKept: false });
      } catch {}
    }
    for (const c of consolidated) {
      const [primary, ...rest] = c.rawIds;
      try {
        await ctx.db.patch(primary as any, {
          reducerKept: true,
          reducerSeverity: c.severity,
          reducerRank: c.rank,
        });
      } catch {}
      for (const id of rest) {
        try {
          await ctx.db.patch(id as any, { reducerKept: false });
        } catch {}
      }
    }
  },
});
