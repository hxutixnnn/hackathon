# Parallel Bug Bounty — Step-by-Step Build (React + Convex)

> **How to read this document:** follow it top-to-bottom. Every file's complete contents are written out. Every command is exact. Every verification step tells you what should be visible before you proceed. If something doesn't match, fix it before moving on — don't pile errors on errors.

---

## Mental Model (60 seconds)

User pastes a GitHub URL. Frontend calls `scans.start` mutation → mutation inserts a scan row + schedules `orchestrator.run` action. Orchestrator downloads the repo, splits files into chunks, and enqueues N agent actions into a Workpool (max 20 parallel). Each agent calls OpenAI, parses JSON findings, writes them via mutation. When the last agent completes, it triggers `reducer.run` which dedupes and ranks. The React UI uses `useQuery` to subscribe to the scan + findings — they update live with zero polling code.

```
Browser ──WS── Convex ──schedule──> orchestrator (Node)
                                       │
                                       └──enqueue × N──> Workpool ──> agent (Node) ──> OpenAI
                                                                          │
                                                                          └─runMutation─> findings table
                                                                                              │
                                                  (last agent fires reducer) ─────────────────┘
```

---

## Stack Decisions (no thinking required)

| Choice | Pick | Why |
|---|---|---|
| Frontend | Vite + React + TypeScript | Fastest scaffold, no SSR overhead |
| Routing | `react-router-dom` v6 | Two routes only |
| Styling | Tailwind | Pre-installed in template |
| Backend | Convex | Reactive UI free, scheduler built-in |
| Concurrency | `@convex-dev/workpool` | Bounded parallelism + retries |
| OpenAI model | `gpt-4o-mini` (swap if event provides specific Codex model) | Cheap, fast, reliable JSON mode |
| Repo download | `@octokit/rest` tarball + `tar` | No git binary needed |
| Validation | `zod` | Catches bad JSON from agents |
| ID generation | Convex provides — don't add `nanoid` | One less dep |

---

## Phase 0 — Pre-11AM (allowed: not writing project code)

Done the night before:

- [ ] `npm i -g convex` and run `npx convex login`
- [ ] `gh auth login`
- [ ] OpenAI key with credit, ready in clipboard
- [ ] Cloned NodeGoat once with `curl` to confirm GitHub tarball download works:
  ```bash
  curl -L https://api.github.com/repos/OWASP/NodeGoat/tarball | tar tz | head
  ```
- [ ] Read this whole document once. Bookmark §"Files in Build Order".

---

## Phase 1 — Scaffold (11:00–11:25, target 25 min)

### 1.1 — Create project (5 min)

Run these in order. Wait for each to finish.

```bash
npm create vite@latest pbb -- --template react-ts
cd pbb
npm install
npm install convex openai @octokit/rest tar zod react-router-dom
npm install -D @types/tar tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

### 1.2 — Tailwind setup (2 min)

Replace `tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
```

Replace `src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### 1.3 — Initialize Convex (5 min)

```bash
npx convex dev
```

This will: prompt you to log in (already done), prompt for project name (`pbb`), create the `convex/` folder, write `.env.local` with `VITE_CONVEX_URL`, and start watching for changes. **Leave this running in its own terminal for the rest of the build.**

In a NEW terminal:

```bash
npx convex env set OPENAI_API_KEY sk-your-key-here
```

### 1.4 — Push to GitHub immediately (3 min)

```bash
git add .
git commit -m "scaffold"
gh repo create pbb --public --source=. --push
```

**Verification:** GitHub repo exists and is public. The Convex dashboard URL printed by `convex dev` opens to a working dashboard.

### 1.5 — Install Workpool component (5 min)

```bash
npm install @convex-dev/workpool
```

Create `convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import workpool from "@convex-dev/workpool/convex.config";

const app = defineApp();
app.use(workpool, { name: "agentPool" });
export default app;
```

The `convex dev` terminal will reload and push. Wait for it to say "Convex functions ready!" before continuing.

### 1.6 — Schema (5 min)

Create `convex/schema.ts`:

```ts
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
    totalAgents: v.number(),       // 0 until orchestrator computes it
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
```

**Verification:** in the Convex dashboard → Data tab, you see two empty tables: `scans` and `findings`.

---

## Phase 2 — Backend (11:25–12:25, target 60 min)

Build files in this order. Each is complete; copy them as-is.

### 2.1 — `convex/prompts.ts` (10 min)

```ts
// Plain TypeScript module — no Convex APIs, no "use node" needed.

export type Angle = {
  id: string;
  name: string;
  extensions: string[]; // file extensions this angle audits, "*" = all text
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
```

### 2.2 — `convex/findings.ts` (10 min)

```ts
import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

// Public query — frontend subscribes to this.
export const byScan = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    return await ctx.db
      .query("findings")
      .withIndex("by_scan", (q) => q.eq("scanId", scanId))
      .collect();
  },
});

// Public query — count by angle, used by AngleGrid.
export const countsByAngle = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_scan", (q) => q.eq("scanId", scanId))
      .collect();
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.angle] = (counts[r.angle] ?? 0) + 1;
    return counts;
  },
});

// Internal — agents call this with their findings batch.
export const insertMany = internalMutation({
  args: {
    scanId: v.id("scans"),
    angle: v.string(),
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
  },
  handler: async (ctx, { scanId, angle, findings }) => {
    for (const f of findings) {
      await ctx.db.insert("findings", { ...f, scanId, angle });
    }
  },
});

// Internal — reducer updates rank/severity/kept on each finding.
export const applyReducer = internalMutation({
  args: {
    scanId: v.id("scans"),
    consolidated: v.array(
      v.object({
        rawIds: v.array(v.string()),
        severity: v.number(),
        rank: v.number(),
      }),
    ),
    discardedIds: v.array(v.string()),
  },
  handler: async (ctx, { scanId, consolidated, discardedIds }) => {
    // Mark discarded
    for (const id of discardedIds) {
      try {
        await ctx.db.patch(id as any, { reducerKept: false });
      } catch { /* finding may not exist if id was hallucinated */ }
    }
    // Apply consolidated rank/severity to the FIRST id in each group; mark others as merged.
    for (const c of consolidated) {
      const [primary, ...rest] = c.rawIds;
      try {
        await ctx.db.patch(primary as any, {
          reducerKept: true,
          reducerSeverity: c.severity,
          reducerRank: c.rank,
        });
      } catch { /* ignore */ }
      for (const id of rest) {
        try {
          await ctx.db.patch(id as any, { reducerKept: false });
        } catch { /* ignore */ }
      }
    }
  },
});
```

### 2.3 — `convex/scans.ts` (10 min)

```ts
import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

export const start = mutation({
  args: { repoUrl: v.string() },
  handler: async (ctx, { repoUrl }) => {
    const scanId = await ctx.db.insert("scans", {
      repoUrl,
      status: "pending",
      totalAgents: 0,
      completedAgents: 0,
      startedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.orchestrator.run, { scanId });
    return scanId;
  },
});

export const get = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => await ctx.db.get(scanId),
});

// Internal: status updates during orchestration.
export const setStatus = internalMutation({
  args: {
    scanId: v.id("scans"),
    status: v.union(
      v.literal("pending"),
      v.literal("cloning"),
      v.literal("scanning"),
      v.literal("reducing"),
      v.literal("done"),
      v.literal("error"),
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { scanId, status, error }) => {
    const patch: any = { status };
    if (error) patch.error = error;
    if (status === "done" || status === "error") patch.finishedAt = Date.now();
    await ctx.db.patch(scanId, patch);
  },
});

export const setTotalAgents = internalMutation({
  args: { scanId: v.id("scans"), total: v.number() },
  handler: async (ctx, { scanId, total }) => {
    await ctx.db.patch(scanId, { totalAgents: total });
  },
});

// Called by each agent on completion. When the last one completes, schedule the reducer.
export const bumpProgress = internalMutation({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return;
    const completed = scan.completedAgents + 1;
    await ctx.db.patch(scanId, { completedAgents: completed });
    if (completed >= scan.totalAgents && scan.totalAgents > 0) {
      await ctx.db.patch(scanId, { status: "reducing" });
      await ctx.scheduler.runAfter(0, internal.reducer.run, { scanId });
    }
  },
});
```

### 2.4 — `convex/repo.ts` (10 min)

```ts
"use node";
// Node-only module: uses fs, tar, octokit. Imported by orchestrator.

import { Octokit } from "@octokit/rest";
import * as tar from "tar";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as zlib from "node:zlib";

const ALLOWED_EXTS = new Set([
  "js","ts","jsx","tsx","py","php","go","rb","java","rs","sh","html","vue","json","txt","toml",
]);
const MAX_FILES = 200;
const MAX_FILE_BYTES = 50_000;

export type RepoFile = { path: string; content: string };

export function parseGithubUrl(url: string): { owner: string; repo: string } {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git|\/|$)/);
  if (!m) throw new Error("Invalid GitHub URL");
  return { owner: m[1], repo: m[2] };
}

export async function downloadRepo(repoUrl: string): Promise<RepoFile[]> {
  const { owner, repo } = parseGithubUrl(repoUrl);
  const octokit = new Octokit();

  // Get tarball as ArrayBuffer.
  const res = await octokit.repos.downloadTarballArchive({ owner, repo, ref: "" });
  const buffer = Buffer.from(res.data as ArrayBuffer);

  // Write to /tmp, extract.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pbb-"));
  const tarPath = path.join(tmpDir, "repo.tar.gz");
  fs.writeFileSync(tarPath, buffer);
  await tar.x({ file: tarPath, cwd: tmpDir });

  // Find the extracted root (octokit gives owner-repo-sha).
  const entries = fs.readdirSync(tmpDir).filter((f) => f !== "repo.tar.gz");
  const root = path.join(tmpDir, entries[0]);

  // Walk and collect.
  const files: RepoFile[] = [];
  walk(root, root, files);
  return files;

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

// Group files into roughly equal chunks for an angle. Pure function, no Node deps.
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
```

### 2.5 — `convex/agents.ts` (10 min)

```ts
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
      // Swallow — log shows in Convex dashboard. Don't fail the scan over one bad agent.
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
```

### 2.6 — `convex/orchestrator.ts` (10 min)

```ts
"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal, components } from "./_generated/api";
import { Workpool } from "@convex-dev/workpool";
import { downloadRepo, chunkFiles } from "./repo";
import { ANGLES } from "./prompts";

const pool = new Workpool(components.agentPool, {
  maxParallelism: 20,
  // Retries are off by default for actions; OpenAI errors are mostly non-retriable.
  // If you hit 429s during demo, set retryActionsByDefault: true.
});

export const run = internalAction({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    try {
      // 1. Cloning
      await ctx.runMutation(internal.scans.setStatus, { scanId, status: "cloning" });
      const scan = await ctx.runQuery(internal.scans_internal.getInternal, { scanId });
      if (!scan) throw new Error("Scan disappeared");

      const files = await downloadRepo(scan.repoUrl);
      if (files.length === 0) throw new Error("No source files found in repo");

      // 2. Build the task matrix: for each angle, chunk its compatible files.
      type Task = { angleId: string; files: { path: string; content: string }[] };
      const tasks: Task[] = [];
      for (const angle of ANGLES) {
        const chunks = chunkFiles(files, angle.extensions);
        for (const chunk of chunks) {
          if (chunk.length > 0) tasks.push({ angleId: angle.id, files: chunk });
        }
      }
      if (tasks.length === 0) throw new Error("No applicable files for any angle");

      // 3. Mark scanning + total.
      await ctx.runMutation(internal.scans.setTotalAgents, { scanId, total: tasks.length });
      await ctx.runMutation(internal.scans.setStatus, { scanId, status: "scanning" });

      // 4. Enqueue all tasks. Workpool handles parallelism.
      for (const task of tasks) {
        await pool.enqueueAction(ctx, internal.agents.audit, {
          scanId,
          angleId: task.angleId,
          files: task.files,
        });
      }
      // Note: bumpProgress will trigger the reducer when all tasks complete.
    } catch (err: any) {
      await ctx.runMutation(internal.scans.setStatus, {
        scanId,
        status: "error",
        error: err?.message ?? String(err),
      });
    }
  },
});
```

### 2.7 — `convex/scans_internal.ts` (3 min)

> Why a separate file: an internal *query* needs to be defined in a non-`"use node"` file to keep it cheap.

```ts
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

export const getInternal = internalQuery({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => await ctx.db.get(scanId),
});

export const findingsForReducer = internalQuery({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    return await ctx.db
      .query("findings")
      .withIndex("by_scan", (q) => q.eq("scanId", scanId))
      .collect();
  },
});
```

### 2.8 — `convex/reducer.ts` (7 min)

```ts
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

      // Strip down to what the LLM needs.
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
```

### 2.9 — Backend smoke test (5 min) — DO NOT SKIP

In Convex dashboard → Functions → `scans:start` → "Run function" with arg:

```json
{ "repoUrl": "https://github.com/OWASP/NodeGoat" }
```

**Verification (within 2 minutes):**
- Logs tab shows `orchestrator:run` firing, then many `agents:audit` invocations.
- Data tab → `scans` row progresses through `cloning` → `scanning` → `reducing` → `done`.
- Data tab → `findings` table fills up. After `done`, some have `reducerRank` set.

If something fails: check the Logs tab for the stack trace. **Fix it now before doing UI work** — debugging through the UI is harder.

---

## Phase 3 — Lunch + UI Skeleton (12:25–12:55, 30 min)

Eat the Burger King. Get the basic UI working end-to-end. Polish in Phase 4.

### 3.1 — `src/main.tsx`

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import Home from "./pages/Home";
import Scan from "./pages/Scan";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/scan/:id" element={<Scan />} />
        </Routes>
      </BrowserRouter>
    </ConvexProvider>
  </React.StrictMode>,
);
```

### 3.2 — `src/pages/Home.tsx`

```tsx
import { useState } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "../../convex/_generated/api";

export default function Home() {
  const [url, setUrl] = useState("https://github.com/OWASP/NodeGoat");
  const [busy, setBusy] = useState(false);
  const start = useMutation(api.scans.start);
  const navigate = useNavigate();

  const onSubmit = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      const scanId = await start({ repoUrl: url.trim() });
      navigate(`/scan/${scanId}`);
    } catch (e: any) {
      alert(e?.message ?? "Failed to start");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        <h1 className="text-4xl font-bold mb-2">Parallel Bug Bounty</h1>
        <p className="text-slate-400 mb-8">Paste a public GitHub repo. 150 agents will audit it in parallel.</p>
        <div className="flex gap-3">
          <input
            className="flex-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
          />
          <button
            onClick={onSubmit}
            disabled={busy}
            className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg font-medium"
          >
            {busy ? "Starting..." : "Scan"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

### 3.3 — `src/pages/Scan.tsx` (skeleton — polished in Phase 4)

```tsx
import { useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export default function Scan() {
  const { id } = useParams<{ id: string }>();
  const scanId = id as Id<"scans">;

  const scan = useQuery(api.scans.get, { scanId });
  const findings = useQuery(api.findings.byScan, { scanId });

  if (!scan) return <div className="p-8 text-slate-100 bg-slate-950 min-h-screen">Loading…</div>;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="mb-4 text-sm text-slate-400">{scan.repoUrl}</div>
      <div className="mb-2 text-2xl font-bold">Status: {scan.status}</div>
      <div className="mb-6 text-slate-400">
        {scan.completedAgents} / {scan.totalAgents} agents complete
      </div>
      <div className="space-y-2">
        {findings?.map((f) => (
          <div key={f._id} className="p-3 bg-slate-900 rounded border border-slate-800">
            <div className="font-mono text-xs text-slate-500">{f.angle}</div>
            <div className="font-medium">{f.title}</div>
            <div className="text-sm text-slate-400">{f.file}:{f.lineStart}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 3.4 — Run

```bash
npm run dev
```

Open the printed localhost URL. Paste a repo URL. Click Scan. Watch findings appear without refreshing.

**Verification:** end-to-end works. If yes → polish. If no → check the Convex Logs tab.

---

## Phase 4 — UI Polish (12:55–2:00, 65 min)

Replace `src/pages/Scan.tsx` with the polished version below. Add the three components.

### 4.1 — `src/components/SeverityBadge.tsx`

```tsx
export default function SeverityBadge({ severity }: { severity: number }) {
  const s = Math.max(1, Math.min(10, Math.round(severity)));
  const cls =
    s >= 9 ? "bg-red-600 text-white" :
    s >= 7 ? "bg-orange-500 text-white" :
    s >= 5 ? "bg-yellow-500 text-slate-900" :
    s >= 3 ? "bg-blue-500 text-white" :
              "bg-slate-600 text-slate-100";
  return (
    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-md font-bold text-sm ${cls}`}>
      {s}
    </span>
  );
}
```

### 4.2 — `src/components/AngleGrid.tsx`

```tsx
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const ANGLE_LABELS: { id: string; label: string }[] = [
  { id: "sql_injection", label: "SQLi" },
  { id: "command_injection", label: "Cmd Inj" },
  { id: "path_traversal", label: "Path" },
  { id: "ssrf", label: "SSRF" },
  { id: "xss", label: "XSS" },
  { id: "authn_bypass", label: "Authn" },
  { id: "authz_idor", label: "IDOR" },
  { id: "secrets", label: "Secrets" },
  { id: "weak_crypto", label: "Crypto" },
  { id: "deserialization", label: "Deser" },
  { id: "race", label: "Race" },
  { id: "proto_pollution", label: "Proto" },
  { id: "open_redirect", label: "Redir" },
  { id: "vuln_deps", label: "Deps" },
  { id: "csrf", label: "CSRF" },
];

export default function AngleGrid({ scanId }: { scanId: Id<"scans"> }) {
  const counts = useQuery(api.findings.countsByAngle, { scanId }) ?? {};
  return (
    <div className="grid grid-cols-5 md:grid-cols-8 lg:grid-cols-15 gap-2">
      {ANGLE_LABELS.map((a) => {
        const n = counts[a.id] ?? 0;
        const cls = n > 0 ? "bg-emerald-600/30 border-emerald-500 text-emerald-200" : "bg-slate-900 border-slate-800 text-slate-500";
        return (
          <div key={a.id} className={`px-2 py-2 rounded border text-center ${cls}`}>
            <div className="text-xs font-mono">{a.label}</div>
            <div className="text-lg font-bold">{n}</div>
          </div>
        );
      })}
    </div>
  );
}
```

### 4.3 — `src/components/FindingsTable.tsx`

```tsx
import { useState } from "react";
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

export default function FindingsTable({ findings, ranked }: { findings: FindingRow[]; ranked: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const visible = ranked
    ? findings.filter((f) => f.reducerKept !== false).sort((a, b) => (a.reducerRank ?? 999) - (b.reducerRank ?? 999))
    : [...findings].sort((a, b) => b.severity - a.severity);

  if (visible.length === 0) {
    return <div className="text-slate-500 text-sm py-8 text-center">No findings yet…</div>;
  }

  return (
    <div className="space-y-2">
      {visible.map((f) => (
        <div key={f._id} className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <button
            className="w-full flex items-start gap-4 p-4 text-left hover:bg-slate-800/50"
            onClick={() => setExpanded(expanded === f._id ? null : f._id)}
          >
            <SeverityBadge severity={f.reducerSeverity ?? f.severity} />
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{f.title}</div>
              <div className="text-xs text-slate-500 font-mono mt-1">
                {f.angle} · {f.file}:{f.lineStart}-{f.lineEnd}
              </div>
            </div>
            <div className="text-slate-500 text-xs">{expanded === f._id ? "▲" : "▼"}</div>
          </button>
          {expanded === f._id && (
            <div className="px-4 pb-4 space-y-3 border-t border-slate-800">
              <div className="text-sm text-slate-300 pt-3">{f.description}</div>
              <pre className="text-xs bg-slate-950 p-3 rounded overflow-x-auto">{f.evidence}</pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

### 4.4 — Replace `src/pages/Scan.tsx` with the polished version

```tsx
import { useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import AngleGrid from "../components/AngleGrid";
import FindingsTable from "../components/FindingsTable";

export default function Scan() {
  const { id } = useParams<{ id: string }>();
  const scanId = id as Id<"scans">;

  const scan = useQuery(api.scans.get, { scanId });
  const findings = useQuery(api.findings.byScan, { scanId });

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
        {/* Header */}
        <div>
          <div className="text-sm text-slate-400 font-mono break-all">{scan.repoUrl}</div>
          <div className="flex items-center gap-4 mt-2">
            <StatusBadge status={scan.status} />
            <div className="text-slate-400 text-sm">{elapsed}s elapsed</div>
            {scan.error && <div className="text-red-400 text-sm">Error: {scan.error}</div>}
          </div>
        </div>

        {/* Progress */}
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

        {/* Angle grid */}
        <div>
          <h2 className="text-sm uppercase tracking-wider text-slate-500 mb-3">Attack angles</h2>
          <AngleGrid scanId={scanId} />
        </div>

        {/* Findings */}
        <div>
          <h2 className="text-sm uppercase tracking-wider text-slate-500 mb-3">
            Findings {ranked && <span className="text-emerald-400">· ranked</span>}
          </h2>
          <FindingsTable findings={(findings ?? []) as any} ranked={ranked} />
        </div>
      </div>
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

**Verification:** Run another scan. You should see:
- Status badge animates through statuses
- Progress bar fills up
- Angle grid lights up green as findings arrive per angle
- Findings list streams in
- After "done", findings re-sort by reducer rank

---

## Phase 5 — Hardening + Demo Rehearsal (2:00–2:45, 45 min)

1. Run a full scan on `https://github.com/OWASP/NodeGoat`. Time it (should be 60–120s).
2. **If too slow (>3 min):** open `convex/orchestrator.ts`, drop `maxParallelism` to 15. Or in `convex/repo.ts`, drop `MAX_FILES` to 100.
3. **If empty findings:** check Convex Logs for parse errors. Check that `OPENAI_API_KEY` is set with `npx convex env list`.
4. **If 429s:** in `convex/orchestrator.ts` Workpool config, add `retryActionsByDefault: true`.
5. Take a screenshot of the finished dashboard.
6. **Deploy frontend (optional):** `npm run build` then drag `dist/` into Netlify drop. **Or just demo from `npm run dev`**, since the Convex backend is already cloud-deployed.
7. Practice the 60-second pitch:
   1. Open Convex dashboard in window 2.
   2. Paste NodeGoat URL, click Scan.
   3. "150 agents firing in parallel — 15 attack angles × ~10 file chunks. Convex Workpool enforces concurrency=20."
   4. Point at dashboard: "Each dot is a real function invocation."
   5. Findings tick in. Click a critical one. Show evidence.
   6. "Reducer dedupes and ranks." Show ranked list.
   7. "Sequential: 10+ minutes. This: 90 seconds. The depth is the orchestration."

---

## Phase 6 — README + Polish (2:45–3:15, 30 min · pizza)

Replace `README.md`:

```md
# Parallel Bug Bounty

50–200 Codex agents fan out in parallel to audit any public GitHub repo for vulnerabilities.

## Architecture

[paste the ASCII diagram from this doc]

## Stack
- React (Vite) + Tailwind
- Convex (database, scheduler, real-time queries)
- @convex-dev/workpool for bounded parallelism (max 20 concurrent agents)
- OpenAI gpt-4o-mini for agents and reducer

## How Codex was used
Each scan dispatches 15 specialized auditor agents (one per attack angle) per file chunk.
Workpool runs them at concurrency=20 with retries. A reducer agent then consolidates
findings, removing duplicates and false positives.

## Why parallel
Sequential: 15 angles × 10 chunks × ~4s = 10 min/scan. Parallel: ~90s.
Without parallelism the demo is unusable; the product *is* the orchestration.

## Demo
1. `npm run dev`
2. Open localhost, paste any public GitHub URL, click Scan.
3. Watch findings stream in real-time via Convex queries (no polling code).

## Built at Weekend Build with Codex, May 9 2026, HCMC
```

Push:

```bash
git add . && git commit -m "polish" && git push
```

---

## Phase 7 — Buffer (3:15–4:00, 45 min)

This is for fixing the inevitable bug. Stretch goals only if everything is solid:

1. Add "Re-run reducer" button (calls `internal.reducer.run` again with a different model).
2. Add file-tree heatmap.
3. Add SARIF export.

Don't ship a half-broken stretch goal at 3:55. Stop at 3:30 and rehearse the pitch one more time.

---

## Common Errors → Fixes

| Error | Fix |
|---|---|
| `Cannot find module '@convex-dev/workpool/convex.config'` | Run `npm install @convex-dev/workpool`. Restart `convex dev`. |
| `internal.X.Y is not a function` | The function is exported as `mutation`/`action`, not `internalMutation`/`internalAction`. Or vice-versa. |
| `tar` import fails in Convex | Check that the file starts with `"use node";` on its own first line. |
| OpenAI returns prose instead of JSON | Make sure `response_format: { type: "json_object" }` is set. |
| Frontend shows `Loading…` forever | Open browser console. Check `VITE_CONVEX_URL` is set in `.env.local`. |
| `useQuery` returns `undefined` | That's "loading" — render a spinner. After data arrives it'll be an array/object. |
| Scan stuck at `cloning` | Repo too big, or invalid URL. Check Convex Logs for the orchestrator error. |
| Schema validation error on insert | A finding's `severity` is outside 1–10, or `lineStart` is missing. Zod should catch this — check it ran. |
| `_generated` types missing | `convex dev` isn't running, or hasn't finished pushing. Save any convex/ file to retrigger. |
| Workpool stuck, agents not running | Check Workpool was registered in `convex.config.ts` with `name: "agentPool"` matching `components.agentPool` in orchestrator.ts. |

---

## The One Thing

If you only remember one rule: **don't move to a new phase until the previous phase's verification step passes.** Cascading errors cost more than slow progress.

End-to-end working ugly demo by 2 PM > beautiful broken demo at 4 PM. Always.
