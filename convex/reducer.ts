"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import OpenAI from "openai";
import { z } from "zod";
import { buildReducerPrompt } from "./prompts";

const ConsolidatedSchema = z.object({
  rawIds: z.array(z.string()),
  angle: z.string().optional(),
  file: z.string().optional(),
  lineStart: z.number().optional(),
  lineEnd: z.number().optional(),
  severity: z.number().int().min(1).max(10),
  rank: z.number().int().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  evidence: z.string().optional(),
});
const ResponseSchema = z.object({
  consolidated: z.array(ConsolidatedSchema),
  discardedIds: z.array(z.string()),
});

export const run = internalAction({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    try {
      const findings = await ctx.runQuery(internal.scans_internal.findingsForReducer, { scanId });

      const trimmed = findings.map((f) => ({
        _id: f._id,
        angle: f.angle,
        file: f.file,
        lineStart: f.lineStart,
        lineEnd: f.lineEnd,
        severity: f.severity,
        title: f.title,
      }));

      let consolidated: z.infer<typeof ResponseSchema> = { consolidated: [], discardedIds: [] };

      if (trimmed.length > 0) {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const res = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: buildReducerPrompt(trimmed) }],
          max_tokens: 4000,
        });
        const text = res.choices[0]?.message?.content ?? "{}";
        const parsed = ResponseSchema.safeParse(JSON.parse(text));
        if (parsed.success) consolidated = parsed.data;
      }

      await ctx.runMutation(internal.findings.applyReducer, {
        scanId,
        consolidated: consolidated.consolidated.map((c) => ({
          rawIds: c.rawIds,
          severity: c.severity,
          rank: c.rank,
        })),
        discardedIds: consolidated.discardedIds,
      });

      await ctx.runMutation(internal.scans.setStatus, { scanId, status: "done" });
    } catch (err: any) {
      await ctx.runMutation(internal.scans.setStatus, {
        scanId,
        status: "error",
        error: err?.message ?? String(err),
      });
    }
  },
});
