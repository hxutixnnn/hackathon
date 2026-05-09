# Remediation Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-side drawer with Explain / Prove / Fix tabs per finding so judges see a complete find-prove-fix loop after every scan.

**Architecture:** Three internal Convex actions (`generateExplain`, `generateProve`, `generateFix`) populate a new `remediations` table keyed by `(findingId, kind)`. Top-3 ranked findings are precomputed eagerly when the reducer marks a scan done; everything else is lazy-loaded via a public `ensure` action triggered from the UI. A new `RemediationDrawer` React component subscribes via Convex live query and renders three tabs.

**Tech Stack:** Convex (queries/mutations/actions), OpenAI gpt-4o-mini, React 19, framer-motion (already installed), react-markdown (new), react-diff-viewer-continued (new), vitest for unit tests.

---

## File Structure

### New files
- `convex/studio.ts` — public `ensure` action, internal generator actions, mutations, `byFinding` query.
- `convex/studio_generators.ts` — pure helpers that build prompts and parse OpenAI responses (so unit tests don't need Convex infra).
- `convex/studio_prompts.ts` — `STUDIO_PROMPTS` with explain/prove(per-angle)/fix templates and angle→proofKind map.
- `src/components/RemediationDrawer.tsx` — slide-in drawer container with tabs.
- `src/components/tabs/ExplainTab.tsx`
- `src/components/tabs/ProveTab.tsx`
- `src/components/tabs/FixTab.tsx`
- `convex/studio_generators.test.ts` — vitest unit tests for pure helpers.
- `convex/studio_prompts.test.ts` — exhaustiveness test for angle map.

### Modified files
- `convex/schema.ts` — add `remediations` table + `clonedSha` optional field on `scans`.
- `convex/repo.ts` — capture sha from tarball top-level dir; export `getCodeSnippet`.
- `convex/reducer.ts` — after `setStatus("done")`, schedule top-3 eager studio jobs.
- `src/components/FindingsTable.tsx` — replace inline-expand with row click; emit `onSelect(findingId)`; render ✨ pill on top-3 with remediations.
- `src/pages/Scan.tsx` — host `selectedFindingId` state; render `RemediationDrawer`.
- `package.json` — add 2 deps.

### Boundaries
- Studio code lives in its own files (`convex/studio*`, `src/components/tabs/*`). The audit pipeline (`agents.ts`, `orchestrator.ts`) is untouched except for the reducer hook in `reducer.ts`.
- Pure generators (`studio_generators.ts`) take an `OpenAIClient`-like dep so they can be tested with a stub. Convex actions in `studio.ts` are thin wrappers that inject the real client and persist results.

---

## Task 1: Add npm dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime deps**

```bash
npm install react-markdown react-diff-viewer-continued
```

- [ ] **Step 2: Verify dev server still builds**

Run: `npm run build`
Expected: build succeeds (TypeScript may warn about unused imports — those are addressed by later tasks).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add react-markdown + react-diff-viewer-continued for remediation studio"
```

---

## Task 2: Schema — additive changes only

**Files:**
- Modify: `convex/schema.ts`

**Important:** The schema also defines `findingCache`, `truth`, and `benchmarks` tables and additional `scans` fields (`cacheHits`, `cacheMisses`, `dedupStartedAt`) added by the dedup/eval pipeline. **Do not remove or alter those.** This task only adds `clonedSha` to `scans` and the new `remediations` table.

- [ ] **Step 1: Add `clonedSha` to the scans table**

Use Edit, not Write. Find the existing scans table block ending with `finishedAt: v.optional(v.number()),` (or whatever last existing field is) and insert `clonedSha: v.optional(v.string()),` immediately before the closing `}),` of the scans table.

After the edit, the scans table block should include all existing fields plus this one new line:

```typescript
    clonedSha: v.optional(v.string()),
```

- [ ] **Step 2: Add the `remediations` table**

Append the new table definition to the schema object (after the last existing table, before the closing `});` of `defineSchema`):

```typescript
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
```

- [ ] **Step 2: Push schema and verify**

Run: `npx convex dev --once` (or rely on the dev process already running — it will pick up the new table).
Expected: schema compiles; new `remediations` table appears in dashboard. No data migration needed.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts
git commit -m "schema: add remediations table + clonedSha on scans"
```

---

## Task 3: Studio prompts — explain template

**Files:**
- Create: `convex/studio_prompts.ts`

- [ ] **Step 1: Create file with explain prompt**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add convex/studio_prompts.ts
git commit -m "studio: explain prompt template"
```

---

## Task 4: Studio prompts — per-angle prove map

**Files:**
- Modify: `convex/studio_prompts.ts`

- [ ] **Step 1: Append the prove map and prompt builder**

Append to `convex/studio_prompts.ts`:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add convex/studio_prompts.ts
git commit -m "studio: per-angle prove templates for all 15 angles"
```

---

## Task 5: Studio prompts — fix template + exhaustiveness test

**Files:**
- Modify: `convex/studio_prompts.ts`
- Create: `convex/studio_prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/studio_prompts.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ANGLES } from "./prompts";
import {
  PROVE_TEMPLATES,
  buildExplainPrompt,
  buildProvePrompt,
  buildFixPrompt,
  FindingForPrompt,
} from "./studio_prompts";

const sampleFinding: FindingForPrompt = {
  angle: "sql_injection",
  file: "src/db.ts",
  lineStart: 10,
  lineEnd: 12,
  severity: 9,
  title: "SQL injection in user lookup",
  description: "User input is concatenated into a SQL query.",
  evidence: "db.query(`SELECT * FROM users WHERE id = ${userId}`)",
};

describe("studio prompts", () => {
  it("has a prove template for every angle", () => {
    for (const angle of ANGLES) {
      expect(PROVE_TEMPLATES[angle.id], `missing prove template for ${angle.id}`).toBeDefined();
    }
  });

  it("buildExplainPrompt includes the file path and snippet", () => {
    const prompt = buildExplainPrompt(sampleFinding, "snippet here");
    expect(prompt).toContain("src/db.ts");
    expect(prompt).toContain("snippet here");
    expect(prompt).toContain("explainMarkdown");
  });

  it("buildProvePrompt embeds the angle-specific instructions", () => {
    const prompt = buildProvePrompt(sampleFinding, "snippet here");
    expect(prompt).toContain("payload");
    expect(prompt).toContain("snippet here");
  });

  it("buildProvePrompt throws for unknown angle", () => {
    expect(() => buildProvePrompt({ ...sampleFinding, angle: "made_up" }, "x")).toThrow();
  });

  it("buildFixPrompt produces a unified-diff instruction", () => {
    const prompt = buildFixPrompt(sampleFinding, "snippet here");
    expect(prompt).toContain("unified diff");
    expect(prompt).toContain("--- a/");
    expect(prompt).toContain("+++ b/");
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run convex/studio_prompts.test.ts`
Expected: FAIL — `buildFixPrompt is not exported` (or similar — one or more of the assertions about fix prompt fail).

- [ ] **Step 3: Add fix prompt builder**

Append to `convex/studio_prompts.ts`:

```typescript
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
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run convex/studio_prompts.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/studio_prompts.ts convex/studio_prompts.test.ts
git commit -m "studio: fix prompt + per-angle exhaustiveness test"
```

---

## Task 6: Pure generator helpers — explain

**Files:**
- Create: `convex/studio_generators.ts`
- Create: `convex/studio_generators.test.ts`

- [ ] **Step 1: Write failing test**

Create `convex/studio_generators.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { runExplainGenerator, OpenAIClient } from "./studio_generators";
import { FindingForPrompt } from "./studio_prompts";

const finding: FindingForPrompt = {
  angle: "xss",
  file: "src/web.ts",
  lineStart: 5,
  lineEnd: 7,
  severity: 8,
  title: "Reflected XSS in /search",
  description: "Query param echoed unescaped.",
  evidence: "res.send(`<h1>${req.query.q}</h1>`)",
};

function fakeClient(reply: string): OpenAIClient {
  return {
    complete: vi.fn().mockResolvedValue(reply),
  };
}

describe("runExplainGenerator", () => {
  it("returns parsed explainMarkdown on valid response", async () => {
    const client = fakeClient(JSON.stringify({ explainMarkdown: "Plain bug.\n\nAttack.\n\nImpact." }));
    const result = await runExplainGenerator(finding, "snippet", client);
    expect(result.explainMarkdown).toContain("Plain bug.");
  });

  it("falls back to raw text when JSON parse fails", async () => {
    const client = fakeClient("not json at all");
    const result = await runExplainGenerator(finding, "snippet", client);
    expect(result.explainMarkdown).toBe("not json at all");
  });

  it("propagates OpenAI errors", async () => {
    const client: OpenAIClient = {
      complete: vi.fn().mockRejectedValue(new Error("rate limit")),
    };
    await expect(runExplainGenerator(finding, "snippet", client)).rejects.toThrow("rate limit");
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run convex/studio_generators.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement explain generator**

Create `convex/studio_generators.ts`:

```typescript
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
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run convex/studio_generators.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/studio_generators.ts convex/studio_generators.test.ts
git commit -m "studio: explain generator with malformed-output fallback"
```

---

## Task 7: Pure generator helpers — prove

**Files:**
- Modify: `convex/studio_generators.ts`
- Modify: `convex/studio_generators.test.ts`

- [ ] **Step 1: Append failing test**

Append to `convex/studio_generators.test.ts`:

```typescript
import { runProveGenerator, runFixGenerator } from "./studio_generators";

describe("runProveGenerator", () => {
  it("returns proofKind+content from valid response", async () => {
    const client = fakeClient(
      JSON.stringify({ proofKind: "payload", proofContent: "' OR 1=1--" }),
    );
    const result = await runProveGenerator(finding, "snippet", client);
    expect(result.proofKind).toBe("payload");
    expect(result.proofContent).toBe("' OR 1=1--");
  });

  it("defaults proofKind to template's expected kind when missing", async () => {
    const sqliFinding = { ...finding, angle: "sql_injection" };
    const client = fakeClient(JSON.stringify({ proofContent: "' OR 1=1--" }));
    const result = await runProveGenerator(sqliFinding, "snippet", client);
    expect(result.proofKind).toBe("payload");
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run convex/studio_generators.test.ts`
Expected: FAIL — `runProveGenerator` not exported.

- [ ] **Step 3: Implement prove generator**

Append to `convex/studio_generators.ts`:

```typescript
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
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run convex/studio_generators.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/studio_generators.ts convex/studio_generators.test.ts
git commit -m "studio: prove generator with proofKind fallback to template default"
```

---

## Task 8: Pure generator helpers — fix

**Files:**
- Modify: `convex/studio_generators.ts`
- Modify: `convex/studio_generators.test.ts`

- [ ] **Step 1: Append failing test**

Append to `convex/studio_generators.test.ts`:

```typescript
describe("runFixGenerator", () => {
  const validDiff =
    "--- a/src/web.ts\n+++ b/src/web.ts\n@@ -5,1 +5,1 @@\n-res.send(`<h1>${req.query.q}</h1>`)\n+res.send(`<h1>${escapeHtml(req.query.q)}</h1>`)";

  it("returns parsed result on valid diff", async () => {
    const client = fakeClient(
      JSON.stringify({
        patchUnifiedDiff: validDiff,
        fixSummary: "Escape user input in /search",
        fixBody: "Apply escapeHtml.",
      }),
    );
    const result = await runFixGenerator(finding, "snippet", client);
    expect(result.patchUnifiedDiff).toContain("--- a/src/web.ts");
    expect(result.fixSummary).toBe("Escape user input in /search");
  });

  it("throws PatchMalformedError when diff missing required headers", async () => {
    const client = fakeClient(
      JSON.stringify({
        patchUnifiedDiff: "no headers here just text",
        fixSummary: "Bad",
        fixBody: "Bad",
      }),
    );
    await expect(runFixGenerator(finding, "snippet", client)).rejects.toThrow(/malformed/);
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run convex/studio_generators.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement fix generator**

Append to `convex/studio_generators.ts`:

```typescript
const FixSchema = z.object({
  patchUnifiedDiff: z.string(),
  fixSummary: z.string(),
  fixBody: z.string(),
});

export type FixResult = {
  patchUnifiedDiff: string;
  fixSummary: string;
  fixBody: string;
};

export class PatchMalformedError extends Error {
  constructor(msg = "patch malformed: missing --- a/ or +++ b/ headers") {
    super(msg);
  }
}

export async function runFixGenerator(
  finding: FindingForPrompt,
  snippet: string,
  client: OpenAIClient,
): Promise<FixResult> {
  const prompt = buildFixPrompt(finding, snippet);
  const text = await client.complete(prompt, 1200);
  const parsed = FixSchema.parse(JSON.parse(text));
  if (!parsed.patchUnifiedDiff.includes("--- a/") || !parsed.patchUnifiedDiff.includes("+++ b/")) {
    throw new PatchMalformedError();
  }
  return parsed;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run convex/studio_generators.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/studio_generators.ts convex/studio_generators.test.ts
git commit -m "studio: fix generator validates unified-diff headers"
```

---

## Task 9: Capture sha during repo download + add `getCodeSnippet`

**Files:**
- Modify: `convex/repo.ts`

- [ ] **Step 1: Update `downloadRepo` to return sha**

Replace `convex/repo.ts` with:

```typescript
"use node";

import { Octokit } from "@octokit/rest";
import * as tar from "tar";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const ALLOWED_EXTS = new Set([
  "js","ts","jsx","tsx","py","php","go","rb","java","rs","sh","html","vue","json","txt","toml",
]);
const MAX_FILES = 200;
const MAX_FILE_BYTES = 50_000;

export type RepoFile = { path: string; content: string };
export type DownloadResult = { files: RepoFile[]; sha?: string };

export function parseGithubUrl(url: string): { owner: string; repo: string } {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git|\/|$)/);
  if (!m) throw new Error("Invalid GitHub URL");
  return { owner: m[1], repo: m[2] };
}

export async function downloadRepo(repoUrl: string): Promise<DownloadResult> {
  const { owner, repo } = parseGithubUrl(repoUrl);
  const octokit = new Octokit();

  const res = await octokit.repos.downloadTarballArchive({ owner, repo, ref: "" });
  const buffer = Buffer.from(res.data as ArrayBuffer);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pbb-"));
  const tarPath = path.join(tmpDir, "repo.tar.gz");
  fs.writeFileSync(tarPath, buffer);
  await tar.x({ file: tarPath, cwd: tmpDir });

  const entries = fs.readdirSync(tmpDir).filter((f) => f !== "repo.tar.gz");
  const root = path.join(tmpDir, entries[0]);
  // GitHub tarball top-level dir is `<owner>-<repo>-<sha7>` or similar
  const shaMatch = entries[0].match(/-([a-f0-9]{7,40})$/);
  const sha = shaMatch?.[1];

  const files: RepoFile[] = [];
  walk(root, root, files);
  return { files, sha };

  function walk(dir: string, base: string, out: RepoFile[]) {
    if (out.length >= MAX_FILES) return;
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(".") || name === "node_modules" || name === "vendor") continue;
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full, base, out);
      } else if (stat.isFile()) {
        const ext = path.extname(name).slice(1).toLowerCase();
        if (!ALLOWED_EXTS.has(ext)) continue;
        if (stat.size > MAX_FILE_BYTES) continue;
        const content = fs.readFileSync(full, "utf8");
        out.push({ path: path.relative(base, full), content });
        if (out.length >= MAX_FILES) return;
      }
    }
  }
}

export function chunkFiles(
  files: RepoFile[],
  allowedExts: string[],
  chunkSizeBytes = 15_000,
): RepoFile[][] {
  const filtered = allowedExts.includes("*")
    ? files
    : files.filter((f) => {
        const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
        return allowedExts.includes(ext);
      });

  const chunks: RepoFile[][] = [];
  let current: RepoFile[] = [];
  let currentBytes = 0;
  for (const f of filtered) {
    const size = f.content.length;
    if (currentBytes + size > chunkSizeBytes && current.length > 0) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(f);
    currentBytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export async function fetchSnippet(
  repoUrl: string,
  sha: string,
  filePath: string,
  lineStart: number,
  lineEnd: number,
  padding = 10,
): Promise<string | null> {
  const { owner, repo } = parseGithubUrl(repoUrl);
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${filePath}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const text = await r.text();
  const lines = text.split("\n");
  const start = Math.max(0, lineStart - 1 - padding);
  const end = Math.min(lines.length, lineEnd + padding);
  return lines.slice(start, end).map((ln, i) => `${String(start + i + 1).padStart(4)}: ${ln}`).join("\n");
}
```

- [ ] **Step 2: Update orchestrator to pass sha through**

Modify `convex/orchestrator.ts` — replace `const files = await downloadRepo(scan.repoUrl);` block:

```typescript
const { files, sha } = await downloadRepo(scan.repoUrl);
if (files.length === 0) throw new Error("No source files found in repo");
if (sha) {
  await ctx.runMutation(internal.scans.setClonedSha, { scanId, sha });
}
```

- [ ] **Step 3: Add `setClonedSha` mutation**

Append to `convex/scans.ts`:

```typescript
export const setClonedSha = internalMutation({
  args: { scanId: v.id("scans"), sha: v.string() },
  handler: async (ctx, { scanId, sha }) => {
    await ctx.db.patch(scanId, { clonedSha: sha });
  },
});
```

- [ ] **Step 4: Run typecheck**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add convex/repo.ts convex/orchestrator.ts convex/scans.ts
git commit -m "studio: capture clonedSha + add fetchSnippet helper"
```

---

## Task 10: Studio mutations and queries

**Files:**
- Create: `convex/studio.ts`

- [ ] **Step 1: Create studio.ts with mutations and query**

```typescript
// convex/studio.ts
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

const KIND = v.union(v.literal("explain"), v.literal("prove"), v.literal("fix"));

export const upsertRunning = internalMutation({
  args: {
    scanId: v.id("scans"),
    findingId: v.id("findings"),
    kind: KIND,
  },
  handler: async (ctx, { scanId, findingId, kind }) => {
    const existing = await ctx.db
      .query("remediations")
      .withIndex("by_finding_kind", (q) => q.eq("findingId", findingId).eq("kind", kind))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "running",
        error: undefined,
        startedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("remediations", {
      scanId,
      findingId,
      kind,
      status: "running",
      startedAt: Date.now(),
    });
  },
});

export const writeResult = internalMutation({
  args: {
    findingId: v.id("findings"),
    kind: KIND,
    payload: v.object({
      explainMarkdown: v.optional(v.string()),
      codeSnippet: v.optional(v.string()),
      proofKind: v.optional(v.string()),
      proofContent: v.optional(v.string()),
      patchUnifiedDiff: v.optional(v.string()),
      fixSummary: v.optional(v.string()),
      fixBody: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { findingId, kind, payload }) => {
    const row = await ctx.db
      .query("remediations")
      .withIndex("by_finding_kind", (q) => q.eq("findingId", findingId).eq("kind", kind))
      .first();
    if (!row) return;
    await ctx.db.patch(row._id, {
      ...payload,
      status: "done",
      finishedAt: Date.now(),
    });
  },
});

export const writeError = internalMutation({
  args: {
    findingId: v.id("findings"),
    kind: KIND,
    error: v.string(),
  },
  handler: async (ctx, { findingId, kind, error }) => {
    const row = await ctx.db
      .query("remediations")
      .withIndex("by_finding_kind", (q) => q.eq("findingId", findingId).eq("kind", kind))
      .first();
    if (!row) return;
    await ctx.db.patch(row._id, {
      status: "error",
      error,
      finishedAt: Date.now(),
    });
  },
});

export const byFinding = query({
  args: { findingId: v.id("findings") },
  handler: async (ctx, { findingId }) => {
    const rows = await ctx.db
      .query("remediations")
      .withIndex("by_finding_kind", (q) => q.eq("findingId", findingId))
      .collect();
    const byKind: Record<string, (typeof rows)[number]> = {};
    for (const r of rows) byKind[r.kind] = r;
    return {
      explain: byKind.explain ?? null,
      prove: byKind.prove ?? null,
      fix: byKind.fix ?? null,
    };
  },
});

export const topThreeFindingIds = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_scan", (q) => q.eq("scanId", scanId))
      .collect();
    return rows
      .filter((f) => f.reducerKept === true)
      .sort((a, b) => b.severity - a.severity)
      .slice(0, 3)
      .map((f) => f._id);
  },
});
```

- [ ] **Step 2: Push schema and verify typecheck**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add convex/studio.ts
git commit -m "studio: mutations + byFinding query"
```

---

## Task 11: Internal action `getFindingForStudio` + OpenAI client wrapper

**Files:**
- Create: `convex/studio_actions.ts`
- Modify: `convex/studio.ts` (add internal query for finding)

- [ ] **Step 1: Add internal query for finding lookup**

Append to `convex/studio.ts`:

```typescript
import { internalQuery } from "./_generated/server";

export const getFinding = internalQuery({
  args: { findingId: v.id("findings") },
  handler: async (ctx, { findingId }) => {
    const finding = await ctx.db.get(findingId);
    if (!finding) return null;
    const scan = await ctx.db.get(finding.scanId);
    return {
      finding,
      repoUrl: scan?.repoUrl,
      clonedSha: scan?.clonedSha,
    };
  },
});
```

- [ ] **Step 2: Create the Node action file**

Create `convex/studio_actions.ts`:

```typescript
"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import OpenAI from "openai";
import {
  runExplainGenerator,
  runProveGenerator,
  runFixGenerator,
  OpenAIClient,
} from "./studio_generators";
import { fetchSnippet } from "./repo";
import { FindingForPrompt } from "./studio_prompts";

const STUDIO_MODEL = "gpt-4o-mini";

function makeClient(): OpenAIClient {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return {
    async complete(prompt, maxTokens) {
      const res = await openai.chat.completions.create({
        model: STUDIO_MODEL,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
      });
      return res.choices[0]?.message?.content ?? "{}";
    },
  };
}

async function loadSnippet(
  repoUrl: string | undefined,
  sha: string | undefined,
  finding: { file: string; lineStart: number; lineEnd: number; evidence: string },
  padding: number,
): Promise<string> {
  if (repoUrl && sha) {
    const fetched = await fetchSnippet(repoUrl, sha, finding.file, finding.lineStart, finding.lineEnd, padding);
    if (fetched) return fetched;
  }
  return finding.evidence;
}

function toFindingForPrompt(f: any): FindingForPrompt {
  return {
    angle: f.angle,
    file: f.file,
    lineStart: f.lineStart,
    lineEnd: f.lineEnd,
    severity: f.severity,
    title: f.title,
    description: f.description,
    evidence: f.evidence,
  };
}

export const generateExplain = internalAction({
  args: { findingId: v.id("findings") },
  handler: async (ctx, { findingId }) => {
    const data = await ctx.runQuery(internal.studio.getFinding, { findingId });
    if (!data || !data.finding) return;
    const { finding, repoUrl, clonedSha } = data;
    await ctx.runMutation(internal.studio.upsertRunning, {
      scanId: finding.scanId,
      findingId,
      kind: "explain",
    });
    try {
      const snippet = await loadSnippet(repoUrl, clonedSha, finding, 10);
      const result = await runExplainGenerator(toFindingForPrompt(finding), snippet, makeClient());
      await ctx.runMutation(internal.studio.writeResult, {
        findingId,
        kind: "explain",
        payload: {
          explainMarkdown: result.explainMarkdown,
          codeSnippet: snippet,
        },
      });
    } catch (err: any) {
      await ctx.runMutation(internal.studio.writeError, {
        findingId,
        kind: "explain",
        error: err?.message ?? String(err),
      });
    }
  },
});

export const generateProve = internalAction({
  args: { findingId: v.id("findings") },
  handler: async (ctx, { findingId }) => {
    const data = await ctx.runQuery(internal.studio.getFinding, { findingId });
    if (!data || !data.finding) return;
    const { finding, repoUrl, clonedSha } = data;
    await ctx.runMutation(internal.studio.upsertRunning, {
      scanId: finding.scanId,
      findingId,
      kind: "prove",
    });
    try {
      const snippet = await loadSnippet(repoUrl, clonedSha, finding, 10);
      const result = await runProveGenerator(toFindingForPrompt(finding), snippet, makeClient());
      await ctx.runMutation(internal.studio.writeResult, {
        findingId,
        kind: "prove",
        payload: {
          proofKind: result.proofKind,
          proofContent: result.proofContent,
        },
      });
    } catch (err: any) {
      await ctx.runMutation(internal.studio.writeError, {
        findingId,
        kind: "prove",
        error: err?.message ?? String(err),
      });
    }
  },
});

export const generateFix = internalAction({
  args: { findingId: v.id("findings") },
  handler: async (ctx, { findingId }) => {
    const data = await ctx.runQuery(internal.studio.getFinding, { findingId });
    if (!data || !data.finding) return;
    const { finding, repoUrl, clonedSha } = data;
    await ctx.runMutation(internal.studio.upsertRunning, {
      scanId: finding.scanId,
      findingId,
      kind: "fix",
    });
    try {
      const snippet = await loadSnippet(repoUrl, clonedSha, finding, 20);
      const result = await runFixGenerator(toFindingForPrompt(finding), snippet, makeClient());
      await ctx.runMutation(internal.studio.writeResult, {
        findingId,
        kind: "fix",
        payload: {
          patchUnifiedDiff: result.patchUnifiedDiff,
          fixSummary: result.fixSummary,
          fixBody: result.fixBody,
        },
      });
    } catch (err: any) {
      await ctx.runMutation(internal.studio.writeError, {
        findingId,
        kind: "fix",
        error: err?.message ?? String(err),
      });
    }
  },
});
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add convex/studio.ts convex/studio_actions.ts
git commit -m "studio: internal generator actions wired to mutations + snippet fallback"
```

---

## Task 12: Public `ensure` action (lazy idempotent trigger)

**Files:**
- Modify: `convex/studio.ts`

- [ ] **Step 1: Add public `ensure` action**

Append to `convex/studio.ts`:

```typescript
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

const KIND_TO_ACTION = {
  explain: internal.studio_actions.generateExplain,
  prove: internal.studio_actions.generateProve,
  fix: internal.studio_actions.generateFix,
} as const;

export const ensure = action({
  args: {
    findingId: v.id("findings"),
    kind: KIND,
  },
  handler: async (ctx, { findingId, kind }): Promise<void> => {
    const existing = await ctx.runQuery(internal.studio.getRemediation, { findingId, kind });
    if (existing && (existing.status === "done" || existing.status === "running")) {
      return;
    }
    await ctx.scheduler.runAfter(0, KIND_TO_ACTION[kind], { findingId });
  },
});

export const getRemediation = internalQuery({
  args: { findingId: v.id("findings"), kind: KIND },
  handler: async (ctx, { findingId, kind }) => {
    return await ctx.db
      .query("remediations")
      .withIndex("by_finding_kind", (q) => q.eq("findingId", findingId).eq("kind", kind))
      .first();
  },
});
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add convex/studio.ts
git commit -m "studio: public ensure action — idempotent lazy scheduler"
```

---

## Task 13: Eager spawn — top-3 hook in dedup pipeline

**Files:**
- Modify: `convex/dedup.ts`
- Modify: `convex/studio.ts`

**Architecture note:** The original `convex/reducer.ts` was replaced by a dedup pipeline (`convex/dedup.ts`). The "scan done" hook is now in `runEvalAndFinish` inside `dedup.ts`, which calls `setStatus({status: "done"})` after dedup (and optional eval) completes. The dedup mutations (`dedup_mutations.applyClusters`) only set `reducerKept` (true/false) — they do NOT set `reducerRank` or `reducerSeverity`. So top-3 ordering uses `severity` desc among `reducerKept===true` findings.

- [ ] **Step 1: Add scheduler call after `setStatus("done")` in `runEvalAndFinish`**

In `convex/dedup.ts`, find the `runEvalAndFinish` helper. The last line is:

```typescript
await ctx.runMutation(internal.scans.setStatus, { scanId, status: "done" });
```

Append after it (still inside the function):

```typescript
  // Schedule top-3 eager studio jobs (3 findings × 3 kinds)
  const topIds: any[] = await ctx.runQuery(internal.studio.topThreeFindingIdsInternal, { scanId });
  for (const id of topIds) {
    await ctx.scheduler.runAfter(0, internal.studio_actions.generateExplain, { findingId: id });
    await ctx.scheduler.runAfter(0, internal.studio_actions.generateProve, { findingId: id });
    await ctx.scheduler.runAfter(0, internal.studio_actions.generateFix, { findingId: id });
  }
```

- [ ] **Step 2: Add internal version of the top-3 query (severity-ordered)**

`topThreeFindingIds` is currently a public `query`. Internal callers (dedup) should use an `internalQuery`. Append to `convex/studio.ts`:

```typescript
export const topThreeFindingIdsInternal = internalQuery({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_scan", (q) => q.eq("scanId", scanId))
      .collect();
    return rows
      .filter((f) => f.reducerKept === true)
      .sort((a, b) => b.severity - a.severity)
      .slice(0, 3)
      .map((f) => f._id);
  },
});
```

- [ ] **Step 3: Update the public `topThreeFindingIds` query to also use severity ordering**

In `convex/studio.ts`, replace the existing `topThreeFindingIds` handler body so it matches the internal version's ordering (severity desc among kept findings). The previous version ordered by `reducerRank` which is no longer populated by the dedup pipeline.

```typescript
export const topThreeFindingIds = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_scan", (q) => q.eq("scanId", scanId))
      .collect();
    return rows
      .filter((f) => f.reducerKept === true)
      .sort((a, b) => b.severity - a.severity)
      .slice(0, 3)
      .map((f) => f._id);
  },
});
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add convex/dedup.ts convex/studio.ts
git commit -m "studio: eager top-3 spawn at end of dedup pipeline (severity-ordered)"
```

---

## Task 14: Drawer container component

**Files:**
- Create: `src/components/RemediationDrawer.tsx`

- [ ] **Step 1: Implement drawer shell**

```typescript
// src/components/RemediationDrawer.tsx
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import SeverityBadge from "./SeverityBadge";
import ExplainTab from "./tabs/ExplainTab";
import ProveTab from "./tabs/ProveTab";
import FixTab from "./tabs/FixTab";

type Kind = "explain" | "prove" | "fix";

export default function RemediationDrawer({
  finding,
  onClose,
}: {
  finding: {
    _id: Id<"findings">;
    title: string;
    file: string;
    lineStart: number;
    lineEnd: number;
    severity: number;
    angle: string;
    description: string;
    evidence: string;
    reducerSeverity?: number;
  } | null;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<Kind>("explain");
  const remediations = useQuery(
    api.studio.byFinding,
    finding ? { findingId: finding._id } : "skip",
  );
  const ensure = useAction(api.studio.ensure);

  useEffect(() => {
    if (finding) {
      setActiveTab("explain");
      ensure({ findingId: finding._id, kind: "explain" }).catch(() => {});
    }
  }, [finding?._id, ensure]);

  return (
    <AnimatePresence>
      {finding && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black z-40"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 240 }}
            className="fixed top-0 right-0 h-full w-full md:w-1/2 bg-slate-950 border-l border-slate-800 z-50 flex flex-col"
          >
            <header className="flex items-start gap-3 p-4 border-b border-slate-800">
              <SeverityBadge severity={finding.reducerSeverity ?? finding.severity} />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{finding.title}</div>
                <div className="text-xs text-slate-500 font-mono mt-1">
                  {finding.angle} · {finding.file}:{finding.lineStart}-{finding.lineEnd}
                </div>
              </div>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-100 px-2">
                ✕
              </button>
            </header>

            <nav className="flex border-b border-slate-800">
              {(["explain", "prove", "fix"] as Kind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    setActiveTab(k);
                    if (k !== "explain") {
                      ensure({ findingId: finding._id, kind: k }).catch(() => {});
                    }
                  }}
                  className={`px-4 py-3 text-sm uppercase tracking-wider ${
                    activeTab === k
                      ? "text-emerald-400 border-b-2 border-emerald-400"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {k}
                </button>
              ))}
            </nav>

            <div className="flex-1 overflow-y-auto p-4">
              {activeTab === "explain" && (
                <ExplainTab finding={finding} row={remediations?.explain ?? null} />
              )}
              {activeTab === "prove" && (
                <ProveTab finding={finding} row={remediations?.prove ?? null} />
              )}
              {activeTab === "fix" && (
                <FixTab finding={finding} row={remediations?.fix ?? null} />
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/RemediationDrawer.tsx
git commit -m "studio: RemediationDrawer shell with tabs and live query"
```

---

## Task 15: ExplainTab

**Files:**
- Create: `src/components/tabs/ExplainTab.tsx`

- [ ] **Step 1: Implement ExplainTab**

```typescript
// src/components/tabs/ExplainTab.tsx
import ReactMarkdown from "react-markdown";

export default function ExplainTab({
  finding,
  row,
}: {
  finding: { lineStart: number; lineEnd: number; evidence: string };
  row: {
    status: "pending" | "running" | "done" | "error";
    explainMarkdown?: string;
    codeSnippet?: string;
    error?: string;
  } | null;
}) {
  const snippet = row?.codeSnippet ?? finding.evidence;

  return (
    <div className="space-y-4">
      <pre className="text-xs bg-slate-900 p-3 rounded overflow-x-auto border border-slate-800">
        {renderHighlighted(snippet, finding.lineStart, finding.lineEnd)}
      </pre>

      {row?.status === "done" && row.explainMarkdown && (
        <div className="prose prose-invert prose-sm max-w-none">
          <ReactMarkdown>{row.explainMarkdown}</ReactMarkdown>
        </div>
      )}

      {(row === null || row.status === "running" || row.status === "pending") && (
        <SkeletonLines />
      )}

      {row?.status === "error" && (
        <div className="bg-red-950/50 border border-red-800 rounded p-3 text-sm">
          <div className="text-red-300 font-medium">Generation failed</div>
          <div className="text-red-400/80 text-xs mt-1 font-mono">{row.error}</div>
        </div>
      )}
    </div>
  );
}

function renderHighlighted(snippet: string, lineStart: number, lineEnd: number) {
  const lines = snippet.split("\n");
  return lines.map((line, i) => {
    const lineMatch = line.match(/^\s*(\d+):/);
    const lineNo = lineMatch ? parseInt(lineMatch[1], 10) : i + 1;
    const isVuln = lineNo >= lineStart && lineNo <= lineEnd;
    return (
      <div
        key={i}
        className={isVuln ? "bg-red-900/40 -mx-3 px-3" : ""}
      >
        {line || " "}
      </div>
    );
  });
}

function SkeletonLines() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-3 bg-slate-800 rounded w-3/4" />
      <div className="h-3 bg-slate-800 rounded w-full" />
      <div className="h-3 bg-slate-800 rounded w-5/6" />
      <div className="h-3 bg-slate-800 rounded w-2/3 mt-4" />
      <div className="h-3 bg-slate-800 rounded w-4/5" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/tabs/ExplainTab.tsx
git commit -m "studio: ExplainTab with code highlight + markdown render"
```

---

## Task 16: ProveTab

**Files:**
- Create: `src/components/tabs/ProveTab.tsx`

- [ ] **Step 1: Implement ProveTab**

```typescript
// src/components/tabs/ProveTab.tsx
import { useState } from "react";

export default function ProveTab({
  finding: _finding,
  row,
}: {
  finding: unknown;
  row: {
    status: "pending" | "running" | "done" | "error";
    proofKind?: string;
    proofContent?: string;
    error?: string;
  } | null;
}) {
  if (row === null || row.status === "running" || row.status === "pending") {
    return <Skeleton />;
  }
  if (row.status === "error") {
    return (
      <div className="bg-red-950/50 border border-red-800 rounded p-3 text-sm">
        <div className="text-red-300 font-medium">Generation failed</div>
        <div className="text-red-400/80 text-xs mt-1 font-mono">{row.error}</div>
      </div>
    );
  }

  const kind = row.proofKind ?? "payload";
  const content = row.proofContent ?? "";

  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-wider text-slate-500">How to reproduce</div>
      {kind === "cve" ? (
        <CveBlock content={content} />
      ) : (
        <CodeBlock content={content} label={labelFor(kind)} />
      )}
    </div>
  );
}

function labelFor(kind: string): string {
  return (
    {
      payload: "payload",
      curl: "curl reproducer",
      hash: "sample hash + crack command",
      diagram: "diagram",
      interleaving: "thread interleaving",
      cve: "CVE",
    } as Record<string, string>
  )[kind] ?? kind;
}

function CodeBlock({ content, label }: { content: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-slate-900 border border-slate-800 rounded">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
        <div className="text-xs text-slate-500 uppercase tracking-wider">{label}</div>
        <button
          onClick={() => {
            navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="text-xs text-emerald-400 hover:text-emerald-300"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="text-xs p-3 overflow-x-auto whitespace-pre-wrap break-all">{content}</pre>
    </div>
  );
}

function CveBlock({ content }: { content: string }) {
  const cveMatch = content.match(/CVE-\d{4}-\d{4,7}/);
  const urlMatch = content.match(/https?:\/\/\S+/);
  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-3 space-y-2">
      {cveMatch && (
        <span className="inline-block bg-red-900/50 text-red-300 px-2 py-1 rounded text-xs font-mono">
          {cveMatch[0]}
        </span>
      )}
      {urlMatch && (
        <a
          href={urlMatch[0]}
          target="_blank"
          rel="noreferrer"
          className="block text-emerald-400 text-xs underline truncate"
        >
          {urlMatch[0]}
        </a>
      )}
      <div className="text-sm text-slate-300">{content}</div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-3 bg-slate-800 rounded w-1/3" />
      <div className="h-20 bg-slate-900 rounded" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/tabs/ProveTab.tsx
git commit -m "studio: ProveTab with per-proofKind renderers + copy button"
```

---

## Task 17: FixTab

**Files:**
- Create: `src/components/tabs/FixTab.tsx`

- [ ] **Step 1: Implement FixTab**

```typescript
// src/components/tabs/FixTab.tsx
import { useState } from "react";
import ReactDiffViewer from "react-diff-viewer-continued";
import ReactMarkdown from "react-markdown";

export default function FixTab({
  finding: _finding,
  row,
}: {
  finding: unknown;
  row: {
    status: "pending" | "running" | "done" | "error";
    patchUnifiedDiff?: string;
    fixSummary?: string;
    fixBody?: string;
    error?: string;
  } | null;
}) {
  const [copied, setCopied] = useState(false);

  if (row === null || row.status === "running" || row.status === "pending") {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-6 bg-slate-800 rounded w-2/3" />
        <div className="h-3 bg-slate-800 rounded w-full" />
        <div className="h-32 bg-slate-900 rounded" />
      </div>
    );
  }

  if (row.status === "error") {
    return (
      <div className="bg-red-950/50 border border-red-800 rounded p-3 text-sm">
        <div className="text-red-300 font-medium">Generation failed</div>
        <div className="text-red-400/80 text-xs mt-1 font-mono">{row.error}</div>
      </div>
    );
  }

  const diff = row.patchUnifiedDiff ?? "";
  const { oldStr, newStr } = parseDiff(diff);
  const empty = oldStr === "" && newStr === "";

  function onFakeOpen() {
    navigator.clipboard.writeText(diff);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-4">
      <div className="border border-slate-800 rounded overflow-hidden">
        <div className="bg-slate-900 px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="bg-emerald-700/40 text-emerald-300 px-2 py-0.5 rounded text-xs">Open</span>
            <span className="font-medium">{row.fixSummary}</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            remediation-studio wants to merge 1 commit
          </div>
        </div>

        {row.fixBody && (
          <div className="p-4 prose prose-invert prose-sm max-w-none border-b border-slate-800">
            <ReactMarkdown>{row.fixBody}</ReactMarkdown>
          </div>
        )}

        {empty ? (
          <div className="p-4 text-sm text-slate-400">
            No fix needed — finding may be a false positive.
          </div>
        ) : (
          <div className="text-xs">
            <ReactDiffViewer
              oldValue={oldStr}
              newValue={newStr}
              splitView={true}
              useDarkTheme={true}
              hideLineNumbers={false}
            />
          </div>
        )}

        <div className="p-4 border-t border-slate-800">
          <button
            onClick={onFakeOpen}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-4 py-2 rounded text-sm"
          >
            {copied ? "✓ Demo mode — patch copied" : "Create pull request"}
          </button>
        </div>
      </div>
    </div>
  );
}

function parseDiff(diff: string): { oldStr: string; newStr: string } {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) continue;
    if (line.startsWith("-")) oldLines.push(line.slice(1));
    else if (line.startsWith("+")) newLines.push(line.slice(1));
    else if (line.startsWith(" ")) {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    }
  }
  return { oldStr: oldLines.join("\n"), newStr: newLines.join("\n") };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/tabs/FixTab.tsx
git commit -m "studio: FixTab with GitHub-PR-styled mock + diff viewer + clipboard"
```

---

## Task 18: Wire FindingsTable to drawer

**Files:**
- Modify: `src/components/FindingsTable.tsx`

- [ ] **Step 1: Add `onSelect` prop, replace inline expand with row click**

Replace `src/components/FindingsTable.tsx` with:

```typescript
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import SeverityBadge from "./SeverityBadge";

export type FindingRow = {
  _id: string;
  angle: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  severity: number;
  title: string;
  description: string;
  evidence: string;
  reducerKept?: boolean;
  reducerSeverity?: number;
  reducerRank?: number;
};

export default function FindingsTable({
  findings,
  ranked,
  pulseWaveAt,
  onSelect,
  topThreeIds,
}: {
  findings: FindingRow[];
  ranked: boolean;
  pulseWaveAt?: number;
  onSelect?: (finding: FindingRow) => void;
  topThreeIds?: Set<string>;
}) {
  const [waveActive, setWaveActive] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dedup pipeline only sets reducerKept; reducerRank/Severity are no longer populated.
  // In ranked mode, show kept findings sorted by severity desc.
  const visible = ranked
    ? findings.filter((f) => f.reducerKept !== false).sort((a, b) => b.severity - a.severity)
    : [...findings].sort((a, b) => b.severity - a.severity);

  const wavePerRowMs = visible.length > 0 ? Math.min(600 / visible.length, 60) : 0;

  useEffect(() => {
    if (pulseWaveAt === undefined) return;
    const duration = 600 + visible.length * wavePerRowMs;
    const activateTimer = setTimeout(() => {
      setWaveActive(true);
      const deactivateTimer = setTimeout(() => setWaveActive(false), duration);
      timerRef.current = deactivateTimer;
    }, 0);
    return () => {
      clearTimeout(activateTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pulseWaveAt, visible.length, wavePerRowMs]);

  if (visible.length === 0) {
    return <div className="text-slate-500 text-sm py-8 text-center">No findings yet…</div>;
  }

  return (
    <div className="space-y-2">
      <AnimatePresence initial={false}>
        {visible.map((f, i) => (
          <motion.button
            key={f._id}
            layout
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, delay: ranked ? i * 0.03 : 0 }}
            onClick={() => onSelect?.(f)}
            className="w-full text-left bg-slate-900 border border-slate-800 rounded-lg p-4 flex items-start gap-4 hover:bg-slate-800/50 hover:border-slate-700 cursor-pointer"
          >
            <SeverityBadge
              severity={f.reducerSeverity ?? f.severity}
              pulse={waveActive}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="font-medium truncate">{f.title}</div>
                {topThreeIds?.has(f._id) && (
                  <span className="text-xs bg-emerald-900/50 text-emerald-300 px-2 py-0.5 rounded shrink-0">
                    ✨ Studio ready
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500 font-mono mt-1">
                {f.angle} · {f.file}:{f.lineStart}-{f.lineEnd}
              </div>
            </div>
            <div className="text-slate-500 text-xs">→</div>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/FindingsTable.tsx
git commit -m "ui: FindingsTable rows clickable; emit onSelect; render top-3 pill"
```

---

## Task 19: Mount drawer in Scan page

**Files:**
- Modify: `src/pages/Scan.tsx`

- [ ] **Step 1: Add drawer state and mount**

Replace `src/pages/Scan.tsx` with:

```typescript
import { useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import AngleGrid from "../components/AngleGrid";
import FindingsTable, { FindingRow } from "../components/FindingsTable";
import RemediationDrawer from "../components/RemediationDrawer";

export default function Scan() {
  const { id } = useParams<{ id: string }>();
  const scanId = id as Id<"scans">;

  const scan = useQuery(api.scans.get, { scanId });
  const findings = useQuery(api.findings.byScan, { scanId });
  const topIds = useQuery(api.studio.topThreeFindingIds, { scanId });
  const [selectedFinding, setSelectedFinding] = useState<FindingRow | null>(null);

  const topSet = useMemo(
    () => new Set((topIds ?? []) as string[]),
    [topIds],
  );

  if (!scan) {
    return <div className="min-h-screen bg-slate-950 text-slate-100 p-8">Loading…</div>;
  }

  const elapsed = scan.finishedAt
    ? Math.round((scan.finishedAt - scan.startedAt) / 1000)
    : Math.round((Date.now() - scan.startedAt) / 1000);

  const pct = scan.totalAgents > 0 ? Math.round((scan.completedAgents / scan.totalAgents) * 100) : 0;
  const ranked = scan.status === "done";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <div className="text-sm text-slate-400 font-mono break-all">{scan.repoUrl}</div>
          <div className="flex items-center gap-4 mt-2">
            <StatusBadge status={scan.status} />
            <div className="text-slate-400 text-sm">{elapsed}s elapsed</div>
            {scan.error && <div className="text-red-400 text-sm">Error: {scan.error}</div>}
          </div>
        </div>

        <div>
          <div className="flex justify-between text-sm text-slate-400 mb-2">
            <span>Agents</span>
            <span className="font-mono">
              {scan.completedAgents} / {scan.totalAgents || "?"}
            </span>
          </div>
          <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div>
          <h2 className="text-sm uppercase tracking-wider text-slate-500 mb-3">Attack angles</h2>
          <AngleGrid scanId={scanId} />
        </div>

        <div>
          <h2 className="text-sm uppercase tracking-wider text-slate-500 mb-3">
            Findings {ranked && <span className="text-emerald-400">· ranked</span>}
          </h2>
          <FindingsTable
            findings={(findings ?? []) as FindingRow[]}
            ranked={ranked}
            onSelect={setSelectedFinding}
            topThreeIds={topSet}
          />
        </div>
      </div>

      <RemediationDrawer
        finding={selectedFinding}
        onClose={() => setSelectedFinding(null)}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "done" ? "bg-emerald-600" :
    status === "error" ? "bg-red-600" :
    status === "reducing" ? "bg-purple-600" :
    "bg-blue-600";
  return <span className={`px-3 py-1 rounded-full text-xs font-medium uppercase tracking-wider ${cls}`}>{status}</span>;
}
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Scan.tsx
git commit -m "ui: mount RemediationDrawer; pass top-3 set to FindingsTable"
```

---

## Task 20: Manual demo verification

**Files:** none (manual testing)

- [ ] **Step 1: Make sure Convex dev + Vite are running**

Run (in two terminals):
```bash
npx convex dev
npm run dev
```

- [ ] **Step 2: End-to-end demo run**

Open the app, paste a small public GitHub URL with known security issues (e.g., a vulnerable-by-design demo repo), click Scan. Wait for status=done.

Verify each item:
- [ ] Top-3 ranked findings show ✨ "Studio ready" pill within ~30s of done.
- [ ] Click top finding row → drawer slides in from the right.
- [ ] Explain tab loads instantly (eager); code snippet shows highlighted vulnerable lines (red bg); 3 paragraphs of markdown render.
- [ ] Click Prove tab → content present (eager); copy button works; for the first finding's angle, content matches the expected proofKind shape.
- [ ] Click Fix tab → diff renders in split view; "Open" pill + summary + body show; click "Create pull request" → button changes to "✓ Demo mode — patch copied"; verify the diff is on the clipboard.
- [ ] Click a non-top-3 finding → drawer opens, Explain tab shows skeleton, then resolves in ~5–10s.
- [ ] Click Prove tab on a non-top-3 finding → skeleton then result.
- [ ] Click Fix tab on a non-top-3 finding → skeleton then result.
- [ ] Close the drawer mid-generation, reopen the same finding → state preserved.
- [ ] Reload the page mid-generation → Explain still shown; rows in `running` state continue to update.

- [ ] **Step 3: Force-error path**

Temporarily break `OPENAI_API_KEY` (set to `sk-invalid`) and trigger generation on a fresh finding:
- [ ] Error card renders with "Generation failed" + message.
- [ ] Restore key. Click the failing tab again — `ensure` reschedules; status returns to running, then done.

- [ ] **Step 4: Commit verification notes if anything needed adjustment**

If any tweak was needed during verification, commit it with the related task. Otherwise, no commit.

---

## Spec Coverage Check

Spec section → plan task:
- Architecture overview → Task 14, 19 (drawer + scan mount); Task 13 (eager hook); Task 12 (lazy ensure).
- Data model → Task 2 (schema).
- Code Snippet Retrieval → Task 9 (`fetchSnippet` + evidence fallback in `loadSnippet`).
- Agent Prompts (Explain / Prove per-angle / Fix) → Tasks 3, 4, 5.
- Convex API surface → Tasks 10, 11, 12, 13.
- Trigger Flow (eager top-3) → Task 13.
- Trigger Flow (lazy on tab click) → Task 14 (auto-fire on open + on tab switch).
- UI Behavior — drawer → Task 14; ExplainTab → Task 15; ProveTab → Task 16; FixTab → Task 17; FindingsTable edits → Task 18.
- Error handling — agent failures → Task 11 (`writeError`); UI error cards → Tasks 15, 16, 17; malformed patch → Task 8 (`PatchMalformedError`).
- Empty diff edge case → Task 17 (`empty` branch).
- Testing — generator unit tests → Tasks 6, 7, 8; angle exhaustiveness → Task 5; manual UI checklist → Task 20.

**Spec items deferred or de-scoped:**
- Reducer integration test ("scan with N kept findings → M studio jobs scheduled") is **not** included as a Convex unit test because the project has no convex-test infrastructure and adding it for one test isn't worth the cost. The `topThreeFindingIdsInternal` query is small and deterministic; the manual verification in Task 20 covers the integration. *If TDD discipline requires it, add Task 13b: install `convex-test`, write the integration test.*
- "Token-cost guard: refuse if scan is older than 24h" — soft guard, not implemented. Add later as a one-line check in `ensure` if cost becomes an issue.
- Local clone fallback in snippet retrieval — not implementable in current architecture (clones are tmp-dir scoped to a single action invocation and not preserved). The plan goes straight to raw URL → evidence fallback chain.
- `framer-motion` is already a dep (verified in `package.json`); no install needed. Only `react-markdown` and `react-diff-viewer-continued` are new.
- Open question from spec ("which syntax highlighter is already a dep") — resolved: no syntax highlighter is installed. Plan uses simple `<pre>` rendering with manual line-range highlighting (Task 15) instead of adding a library.

---

## Self-Review Notes

After writing this plan I checked:
- All identifiers are consistent across tasks: `STUDIO_MODEL` in Task 11; `KIND_TO_ACTION` map in Task 12; `topThreeFindingIdsInternal` in Task 13; etc. No drift.
- Every code step shows complete code; no "similar to above" placeholders.
- Tasks 6/7/8 each end with running tests — TDD discipline preserved.
- No reference to functions that aren't created somewhere in the plan.
