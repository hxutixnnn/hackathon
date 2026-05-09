import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

export const getInternal = internalQuery({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => await ctx.db.get(scanId),
});

export const findingsForReducer = internalQuery({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    return await ctx.db
      .query("findings")
      .withIndex("by_scan", (q) => q.eq("scanId", scanId))
      .collect();
  },
});
