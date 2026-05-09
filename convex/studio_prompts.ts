// convex/studio_prompts.ts
import { ANGLES } from "./prompts";

export type ProofKind =
  | "payload"
  | "curl"
  | "diagram"
  | "cve"
  | "hash"
  | "interleaving";

export type FindingForPrompt = {
  angle: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  severity: number;
  title: string;
  description: string;
  evidence: string;
};

export function buildExplainPrompt(f: FindingForPrompt, snippet: string): string {
  return `You are a security expert explaining a vulnerability to an engineer who must fix it.

Vulnerability: ${f.title}
Type: ${f.angle}
File: ${f.file}:${f.lineStart}-${f.lineEnd}
Auditor description: ${f.description}

Code (with vulnerable lines):
\`\`\`
${snippet}
\`\`\`

Output ONLY valid JSON. Schema:
{ "explainMarkdown": "..." }

The explainMarkdown field must contain markdown with EXACTLY three short paragraphs:
1. What is vulnerable, in plain English (no jargon).
2. How an attacker exploits it (concrete attack flow).
3. Real-world impact (data leak, RCE, account takeover, etc.).

No headings. No bullet points. No code blocks. Plain prose.`;
}
