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
