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

export const angleSummaries = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_scan", (q) => q.eq("scanId", scanId))
      .collect();
    const byAngle: Record<string, { count: number; maxSeverity: number; latestAt: number }> = {};
    for (const r of rows) {
      const cur = byAngle[r.angle] ?? { count: 0, maxSeverity: 0, latestAt: 0 };
      cur.count += 1;
      cur.maxSeverity = Math.max(cur.maxSeverity, r.severity);
      cur.latestAt = Math.max(cur.latestAt, r._creationTime);
      byAngle[r.angle] = cur;
    }
    return Object.entries(byAngle).map(([angle, v]) => ({
      angle,
      count: v.count,
      maxSeverity: v.maxSeverity,
      latestAt: v.latestAt,
    }));
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
  handler: async (ctx, { consolidated, discardedIds }) => {
    for (const id of discardedIds) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await ctx.db.patch(id as any, { reducerKept: false });
      } catch {
        // Ignore patch failures
      }
    }
    for (const c of consolidated) {
      const [primary, ...rest] = c.rawIds;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await ctx.db.patch(primary as any, {
          reducerKept: true,
          reducerSeverity: c.severity,
          reducerRank: c.rank,
        });
      } catch {
        // Ignore patch failures
      }
      for (const id of rest) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await ctx.db.patch(id as any, { reducerKept: false });
        } catch {
          // Ignore patch failures
        }
      }
    }
  },
});
