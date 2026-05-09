import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const applyClusters = internalMutation({
  args: {
    keptIds: v.array(v.string()),
    droppedIds: v.array(v.string()),
  },
  handler: async (ctx, { keptIds, droppedIds }) => {
    for (const id of keptIds) {
      try {
        await ctx.db.patch(id as any, { reducerKept: true });
      } catch {}
    }
    for (const id of droppedIds) {
      try {
        await ctx.db.patch(id as any, { reducerKept: false });
      } catch {}
    }
  },
});

export const applyRerank = internalMutation({
  args: {
    ranks: v.array(
      v.object({
        id: v.string(),
        rank: v.number(),
        severity: v.number(),
      }),
    ),
  },
  handler: async (ctx, { ranks }) => {
    for (const r of ranks) {
      try {
        await ctx.db.patch(r.id as any, {
          reducerRank: r.rank,
          reducerSeverity: r.severity,
        });
      } catch {}
    }
  },
});
