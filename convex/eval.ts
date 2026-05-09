import { v } from "convex/values";
import { internalAction, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { scoreScan, corpusFor } from "./lib/eval";

export const score = internalAction({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.runQuery(internal.scans_internal.getInternal, {
      scanId,
    });
    if (!scan) return;
    const corpus = corpusFor(scan.repoUrl);
    if (!corpus) return;

    const truth = await ctx.runQuery(internal.truth.byCorpusInternal, {
      corpus,
    });
    const findings = await ctx.runQuery(
      internal.scans_internal.keptFindings,
      { scanId },
    );

    const result = scoreScan(
      truth.map((t: any) => ({
        _id: t._id,
        file: t.file,
        lineStart: t.lineStart,
        lineEnd: t.lineEnd,
      })),
      findings.map((f: any) => ({
        _id: f._id,
        file: f.file,
        lineStart: f.lineStart,
        lineEnd: f.lineEnd,
      })),
    );

    await ctx.runMutation(internal.eval.writeBenchmark, {
      scanId,
      corpus,
      tp: result.tp,
      fp: result.fp,
      fn: result.fn,
      precision: result.precision,
      recall: result.recall,
      f1: result.f1,
      matchedTruthIds: result.matchedTruthIds,
      matchedFindingIds: result.matchedFindingIds,
    });
  },
});

export const writeBenchmark = internalMutation({
  args: {
    scanId: v.id("scans"),
    corpus: v.string(),
    tp: v.number(),
    fp: v.number(),
    fn: v.number(),
    precision: v.number(),
    recall: v.number(),
    f1: v.number(),
    matchedTruthIds: v.array(v.string()),
    matchedFindingIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("benchmarks", {
      scanId: args.scanId,
      corpus: args.corpus,
      tp: args.tp,
      fp: args.fp,
      fn: args.fn,
      precision: args.precision,
      recall: args.recall,
      f1: args.f1,
      matchedTruthIds: args.matchedTruthIds as any,
      matchedFindingIds: args.matchedFindingIds as any,
    });
  },
});

export const benchmarkByScan = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    return await ctx.db
      .query("benchmarks")
      .withIndex("by_scan", (q) => q.eq("scanId", scanId))
      .first();
  },
});
