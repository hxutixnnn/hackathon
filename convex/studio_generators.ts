import { z } from "zod";
import {
  buildExplainPrompt,
  buildProvePrompt,
  buildFixPrompt,
  FindingForPrompt,
  PROVE_TEMPLATES,
} from "./studio_prompts";

export interface OpenAIClient {
  complete(prompt: string, maxTokens: number): Promise<string>;
}

const ExplainSchema = z.object({ explainMarkdown: z.string() });

export type ExplainResult = { explainMarkdown: string };

export async function runExplainGenerator(
  finding: FindingForPrompt,
  snippet: string,
  client: OpenAIClient,
): Promise<ExplainResult> {
  const prompt = buildExplainPrompt(finding, snippet);
  const text = await client.complete(prompt, 800);
  try {
    const parsed = ExplainSchema.parse(JSON.parse(text));
    return { explainMarkdown: parsed.explainMarkdown };
  } catch {
    return { explainMarkdown: text };
  }
}

// buildProvePrompt, buildFixPrompt, PROVE_TEMPLATES will be used in Tasks 7 and 8
export { buildProvePrompt, buildFixPrompt, PROVE_TEMPLATES };

const ProveSchema = z.object({
  proofKind: z.string().optional(),
  proofContent: z.string(),
});

export type ProveResult = { proofKind: string; proofContent: string };

export async function runProveGenerator(
  finding: FindingForPrompt,
  snippet: string,
  client: OpenAIClient,
): Promise<ProveResult> {
  const prompt = buildProvePrompt(finding, snippet);
  const text = await client.complete(prompt, 800);
  const parsed = ProveSchema.parse(JSON.parse(text));
  const fallbackKind = PROVE_TEMPLATES[finding.angle]?.proofKind ?? "payload";
  return {
    proofKind: parsed.proofKind ?? fallbackKind,
    proofContent: parsed.proofContent,
  };
}
