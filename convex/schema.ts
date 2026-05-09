import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  scans: defineTable({
    repoUrl: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("cloning"),
      v.literal("scanning"),
      v.literal("reducing"),
      v.literal("done"),
      v.literal("error"),
    ),
    totalAgents: v.number(),
    completedAgents: v.number(),
    error: v.optional(v.string()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    cacheHits: v.optional(v.number()),
    cacheMisses: v.optional(v.number()),
    dedupStartedAt: v.optional(v.number()),
    clonedSha: v.optional(v.string()),
  }),

  findings: defineTable({
    scanId: v.id("scans"),
    angle: v.string(),
    file: v.string(),
    lineStart: v.number(),
    lineEnd: v.number(),
    severity: v.number(),
    title: v.string(),
    description: v.string(),
    evidence: v.string(),
    reducerKept: v.optional(v.boolean()),
    reducerSeverity: v.optional(v.number()),
    reducerRank: v.optional(v.number()),
  }).index("by_scan", ["scanId"]),

  findingCache: defineTable({
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
    createdAt: v.number(),
  }).index("by_key", ["cacheKey"]),

  truth: defineTable({
    corpus: v.string(),
    file: v.string(),
    lineStart: v.number(),
    lineEnd: v.number(),
    cwe: v.optional(v.string()),
    title: v.string(),
    source: v.string(),
  }).index("by_corpus", ["corpus"]),

  benchmarks: defineTable({
    scanId: v.id("scans"),
    corpus: v.string(),
    tp: v.number(),
    fp: v.number(),
    fn: v.number(),
    precision: v.number(),
    recall: v.number(),
    f1: v.number(),
    matchedTruthIds: v.array(v.id("truth")),
    matchedFindingIds: v.array(v.id("findings")),
  }).index("by_scan", ["scanId"]),

  remediations: defineTable({
    scanId: v.id("scans"),
    findingId: v.id("findings"),
    kind: v.union(v.literal("explain"), v.literal("prove"), v.literal("fix")),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("done"),
      v.literal("error"),
    ),
    explainMarkdown: v.optional(v.string()),
    codeSnippet: v.optional(v.string()),
    proofKind: v.optional(v.string()),
    proofContent: v.optional(v.string()),
    patchUnifiedDiff: v.optional(v.string()),
    fixSummary: v.optional(v.string()),
    fixBody: v.optional(v.string()),
    error: v.optional(v.string()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_finding_kind", ["findingId", "kind"])
    .index("by_scan", ["scanId"]),
});
