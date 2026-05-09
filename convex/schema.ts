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
});
