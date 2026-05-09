import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { JUICE_SHOP_TRUTH } from "./truth_data";

export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("truth")
      .withIndex("by_corpus", (q) => q.eq("corpus", "juice-shop"))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);
    for (const t of JUICE_SHOP_TRUTH) {
      await ctx.db.insert("truth", { corpus: "juice-shop", ...t });
    }
  },
});

export const byCorpus = query({
  args: { corpus: v.string() },
  handler: async (ctx, { corpus }) => {
    return await ctx.db
      .query("truth")
      .withIndex("by_corpus", (q) => q.eq("corpus", corpus))
      .collect();
  },
});

export const byCorpusInternal = internalQuery({
  args: { corpus: v.string() },
  handler: async (ctx, { corpus }) => {
    return await ctx.db
      .query("truth")
      .withIndex("by_corpus", (q) => q.eq("corpus", corpus))
      .collect();
  },
});
