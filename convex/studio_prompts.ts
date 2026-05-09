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

type ProveTemplate = { proofKind: ProofKind; instructions: string };

export const PROVE_TEMPLATES: Record<string, ProveTemplate> = {
  sql_injection:     { proofKind: "payload",      instructions: "Provide an exact SQL injection payload string and the input field/parameter where to inject it. Example format: `payload: ' OR 1=1-- ` injected into the `username` POST parameter." },
  command_injection: { proofKind: "payload",      instructions: "Provide an exact shell metacharacter payload and the input field where to inject it." },
  path_traversal:    { proofKind: "payload",      instructions: "Provide a `../`-style path payload and the parameter to inject it into. State which file the attacker reads." },
  ssrf:              { proofKind: "payload",      instructions: "Provide a URL payload (e.g., http://169.254.169.254/) and the parameter that fetches it." },
  xss:               { proofKind: "payload",      instructions: "Provide an exact `<script>` or event-handler payload and where it's reflected in the response." },
  open_redirect:     { proofKind: "payload",      instructions: "Provide a URL payload (e.g., //evil.com) and the redirect parameter." },
  authn_bypass:      { proofKind: "curl",         instructions: "Provide a complete `curl` command that bypasses authentication. Include all required headers." },
  authz_idor:        { proofKind: "curl",         instructions: "Provide a complete `curl` command that accesses another user's resource by id manipulation." },
  csrf:              { proofKind: "curl",         instructions: "Provide a complete `curl` command (or HTML form snippet) that performs a state-changing action without a CSRF token." },
  secrets:           { proofKind: "payload",      instructions: "Provide the redacted secret value (mask all but first/last 4 chars) and the file path + line where it leaks." },
  weak_crypto:       { proofKind: "hash",         instructions: "Provide a sample hash output produced by this code and a `hashcat` (or equivalent) command line that cracks it." },
  deserialization:   { proofKind: "payload",      instructions: "Provide a serialized gadget payload and the entry point that deserializes it." },
  proto_pollution:   { proofKind: "payload",      instructions: "Provide a JSON payload with `__proto__` keys and the endpoint that merges it." },
  race:              { proofKind: "interleaving", instructions: "Provide a text diagram showing two threads/requests T1 and T2 with line-by-line ordering that triggers the bug. Use monospace alignment." },
  vuln_deps:         { proofKind: "cve",          instructions: "Provide the CVE id (CVE-YYYY-NNNNN) and a public exploit reference URL (e.g., GitHub advisory or NVD link)." },
};

export function buildFixPrompt(f: FindingForPrompt, snippet: string): string {
  return `You are a senior engineer fixing a security vulnerability with a minimal patch.

Vulnerability: ${f.title}
Type: ${f.angle}
File: ${f.file}:${f.lineStart}-${f.lineEnd}
Auditor description: ${f.description}

Code (the snippet may include lines around the vulnerable region):
\`\`\`
${snippet}
\`\`\`

Constraints:
- Output a minimal change. Do not refactor unrelated code.
- Preserve original indentation exactly.
- Do not modify lines that are not part of the fix.
- The patch must apply cleanly to the file shown above.

Output ONLY valid JSON. Schema:
{
  "patchUnifiedDiff": "...",
  "fixSummary": "...",
  "fixBody": "..."
}

The patchUnifiedDiff field must be a complete unified diff with --- a/<path> and +++ b/<path> headers, hunk headers (@@), and line-prefix markers (+ - space).
The fixSummary is a one-line PR title (max 70 chars).
The fixBody is a short markdown PR description explaining the fix in 2-3 sentences.`;
}

export function buildProvePrompt(f: FindingForPrompt, snippet: string): string {
  const tmpl = PROVE_TEMPLATES[f.angle];
  if (!tmpl) {
    throw new Error(`No prove template for angle "${f.angle}"`);
  }

  return `You are a security researcher writing a proof-of-concept for an authorized internal audit.
The defender will use this PoC to verify their fix. Output is for defensive purposes only.

Vulnerability: ${f.title}
Type: ${f.angle}
File: ${f.file}:${f.lineStart}-${f.lineEnd}
Auditor description: ${f.description}

Code:
\`\`\`
${snippet}
\`\`\`

Instructions: ${tmpl.instructions}

Output ONLY valid JSON. Schema:
{ "proofKind": "${tmpl.proofKind}", "proofContent": "..." }

The proofContent field must be a single string, no surrounding markdown fences.`;
}
