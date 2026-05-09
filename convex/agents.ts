"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import OpenAI from "openai";
import { z } from "zod";
import { ANGLES, buildAgentPrompt } from "./prompts";

const FindingSchema = z.object({
  file: z.string(),
  lineStart: z.number().int().nonnegative(),
  lineEnd: z.number().int().nonnegative(),
  severity: z.number().int().min(1).max(10),
  title: z.string().max(200),
  description: z.string().max(1000),
  evidence: z.string().max(2000),
});
const ResponseSchema = z.object({ findings: z.array(FindingSchema) });

export const audit = internalAction({
  args: {
    scanId: v.id("scans"),
    angleId: v.string(),
    files: v.array(v.object({ path: v.string(), content: v.string() })),
  },
  handler: async (ctx, { scanId, angleId, files }) => {
    const angle = ANGLES.find((a) => a.id === angleId);
    if (!angle) {
      await ctx.runMutation(internal.scans.bumpProgress, { scanId });
      return;
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let parsed: z.infer<typeof ResponseSchema> = { findings: [] };

    try {
      const res = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: buildAgentPrompt(angle, files) }],
        max_tokens: 2000,
      });
      const text = res.choices[0]?.message?.content ?? "{}";
      const json = JSON.parse(text);
      const result = ResponseSchema.safeParse(json);
      if (result.success) parsed = result.data;
    } catch (err) {
      console.error("agent error", angleId, err);
    }

    if (parsed.findings.length > 0) {
      await ctx.runMutation(internal.findings.insertMany, {
        scanId,
        angle: angleId,
        findings: parsed.findings,
      });
    }

    await ctx.runMutation(internal.scans.bumpProgress, { scanId });
  },
});
