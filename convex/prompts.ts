export type Angle = {
  id: string;
  name: string;
  extensions: string[];
  promptName: string;
};

export const ANGLES: Angle[] = [
  { id: "sql_injection",    name: "SQL injection",          extensions: ["js","ts","py","php","go","rb"],          promptName: "SQL injection" },
  { id: "command_injection",name: "Command injection",      extensions: ["js","ts","py","php","go","rb","sh"],     promptName: "command injection" },
  { id: "path_traversal",   name: "Path traversal",         extensions: ["js","ts","py","php","go","rb","java"],   promptName: "path traversal" },
  { id: "ssrf",             name: "SSRF",                   extensions: ["js","ts","py","php","go","rb","java"],   promptName: "server-side request forgery" },
  { id: "xss",              name: "XSS",                    extensions: ["js","ts","jsx","tsx","php","html","vue"],promptName: "cross-site scripting" },
  { id: "authn_bypass",     name: "Auth bypass",            extensions: ["js","ts","py","php","go","rb","java"],   promptName: "authentication bypass" },
  { id: "authz_idor",       name: "IDOR / authz",           extensions: ["js","ts","py","php","go","rb","java"],   promptName: "broken access control / IDOR" },
  { id: "secrets",          name: "Hardcoded secrets",      extensions: ["*"],                                      promptName: "hardcoded secrets, API keys, or tokens" },
  { id: "weak_crypto",      name: "Weak crypto",            extensions: ["js","ts","py","php","go","rb","java"],   promptName: "weak cryptography (MD5/SHA1 for passwords, ECB, hardcoded IV)" },
  { id: "deserialization",  name: "Insecure deserialization",extensions:["js","ts","py","php","rb"],                promptName: "insecure deserialization" },
  { id: "race",             name: "Race conditions",        extensions: ["js","ts","py","go","java","rs"],         promptName: "race conditions / TOCTOU" },
  { id: "proto_pollution",  name: "Prototype pollution",    extensions: ["js","ts","jsx","tsx"],                   promptName: "prototype pollution" },
  { id: "open_redirect",    name: "Open redirect",          extensions: ["js","ts","py","php","go","rb"],          promptName: "open redirect" },
  { id: "vuln_deps",        name: "Vulnerable deps",        extensions: ["json","txt","toml"],                     promptName: "vulnerable dependencies" },
  { id: "csrf",             name: "CSRF",                   extensions: ["js","ts","py","php","go","rb"],          promptName: "CSRF (state-changing endpoint without token)" },
];

export function buildAgentPrompt(angle: Angle, files: { path: string; content: string }[]): string {
  const filesBlock = files
    .map((f) => {
      const numbered = f.content
        .split("\n")
        .map((line, i) => `${String(i + 1).padStart(4)}: ${line}`)
        .join("\n");
      return `=== ${f.path} ===\n${numbered}`;
    })
    .join("\n\n");

  return `You are a security auditor specialized in ${angle.promptName}.
Review the following files and report ONLY genuine ${angle.promptName} vulnerabilities.
Do not report style issues, code smells, or other vulnerability types.
Do not invent issues. If nothing is found, return {"findings": []}.

Output ONLY valid JSON. No prose, no markdown. Schema:
{
  "findings": [
    {
      "file": "<relative path as shown>",
      "lineStart": <int>,
      "lineEnd": <int>,
      "severity": <integer 1-10, where 10 = RCE/critical>,
      "title": "<one-line summary>",
      "description": "<2-3 sentence explanation of vulnerability and impact>",
      "evidence": "<exact vulnerable code snippet, max 10 lines>"
    }
  ]
}

Files:
---
${filesBlock}
---`;
}

export function buildReducerPrompt(rawFindings: any[]): string {
  return `You are a senior security reviewer consolidating findings from 15 parallel auditors.
Your job: dedupe, rank by exploitability + impact, and discard false positives.

Rules:
- Merge duplicates (same file + overlapping lines + same vulnerability class).
- Cross-agent agreement = higher confidence = higher final severity.
- Drop clear false positives (test fixtures, intentional examples, comments).
- Rank starts at 1 for most severe.

Output ONLY valid JSON. Schema:
{
  "consolidated": [
    {
      "rawIds": [<original Convex _id strings>],
      "angle": "<dominant angle id>",
      "file": "...",
      "lineStart": <int>,
      "lineEnd": <int>,
      "severity": <int 1-10>,
      "rank": <int starting at 1>,
      "title": "...",
      "description": "...",
      "evidence": "..."
    }
  ],
  "discardedIds": [<_ids of false positives>]
}

Raw findings:
${JSON.stringify(rawFindings, null, 2)}`;
}
