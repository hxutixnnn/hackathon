# Parallel Bug Bounty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hackathon-day React + Convex app that fans out 150 parallel security-audit agents over a public GitHub repo, then dedupes/ranks results — live UI updates via Convex reactive queries.

**Architecture:** Vite/React frontend talks to Convex over WebSocket. `scans.start` mutation inserts a row + schedules `orchestrator.run` (Node action). Orchestrator downloads tarball, chunks files per attack angle, enqueues N audit tasks into `@convex-dev/workpool` (max parallelism 20). Each agent calls OpenAI `gpt-4o-mini` (JSON mode), validates with zod, writes findings via internal mutation, bumps progress. Last completing agent triggers `reducer.run` to consolidate findings via a second LLM call.

**Tech Stack:** Vite + React + TypeScript, Tailwind, react-router-dom v6, Convex (DB + scheduler + reactive queries), `@convex-dev/workpool`, OpenAI `gpt-4o-mini`, `@octokit/rest` + `tar`, zod.

**Testing approach:** Hackathon-day plan — no test framework setup. Verification is Convex dashboard smoke tests + browser end-to-end checks at each phase boundary, mirroring the source spec. Each "Verify" step shows the exact expected dashboard/log state before moving on.

**Source spec:** `docs/parallel-bug-bounty-convex-step-by-step.md`.

---

## File Structure

Backend (Convex functions):
- `convex/convex.config.ts` — register Workpool component as `agentPool`.
- `convex/schema.ts` — `scans` and `findings` tables (+ `by_scan` index).
- `convex/prompts.ts` — pure TS module: `ANGLES` list, `buildAgentPrompt`, `buildReducerPrompt`. No Convex APIs, no `"use node"`.
- `convex/findings.ts` — public `byScan` + `countsByAngle` queries; internal `insertMany` + `applyReducer` mutations.
- `convex/scans.ts` — public `start` mutation + `get` query; internal `setStatus`, `setTotalAgents`, `bumpProgress` mutations.
- `convex/scans_internal.ts` — internal queries (`getInternal`, `findingsForReducer`). Separate from `scans.ts` to keep them out of any `"use node"` runtime.
- `convex/repo.ts` — `"use node"` module: `parseGithubUrl`, `downloadRepo`, `chunkFiles`. Filesystem + tar.
- `convex/agents.ts` — `"use node"` internal action: build prompt, call OpenAI, zod-validate, insert findings, bump progress.
- `convex/orchestrator.ts` — `"use node"` internal action: download repo, build task matrix (angles × chunks), set total, enqueue all into Workpool.
- `convex/reducer.ts` — `"use node"` internal action: pull all findings, ask LLM to consolidate, apply rank/severity, mark `done`.

Frontend:
- `src/main.tsx` — `ConvexProvider` + router with `/` → Home, `/scan/:id` → Scan.
- `src/pages/Home.tsx` — repo URL form, calls `scans.start`, navigates to scan page.
- `src/pages/Scan.tsx` — subscribes to scan + findings, renders progress + angle grid + findings table.
- `src/components/SeverityBadge.tsx` — colored 1–10 chip.
- `src/components/AngleGrid.tsx` — 15-cell grid, lights up green per angle as findings stream.
- `src/components/FindingsTable.tsx` — collapsible rows, sorts by reducer rank when scan is `done` else by severity.
- `src/index.css` — Tailwind directives.
- `tailwind.config.js` — Tailwind content globs.

Config / docs:
- `.env.local` — `VITE_CONVEX_URL` (auto-written by `convex dev`).
- `README.md` — final pitch + arch summary.

Boundaries: `prompts.ts` is pure (no Convex/Node) so it can be imported by both Node actions and (if later wanted) plain queries. `scans_internal.ts` exists so internal queries live outside any `"use node"` action file. `repo.ts` is Node-only because tar/fs.

---

## Phase 0 — Pre-flight (do night before)

### Task 0: Tooling installed

**Files:** none.

- [ ] **Step 1: Install Convex CLI globally and log in**

```bash
npm i -g convex
npx convex login
```

- [ ] **Step 2: Authenticate gh CLI**

```bash
gh auth login
```

- [ ] **Step 3: Confirm tarball download path works**

```bash
curl -L https://api.github.com/repos/OWASP/NodeGoat/tarball | tar tz | head
```

Expected: list of file paths inside the NodeGoat repo, no error.

- [ ] **Step 4: Confirm OpenAI key is in clipboard / saved**

Verify: paste it somewhere safe, format `sk-...`, has billing credit.

---

## Phase 1 — Scaffold

### Task 1: Vite + React + TS scaffold + deps

**Files:**
- Create: `pbb/` (project root, all subsequent paths relative to here)
- Create: `pbb/package.json` (via Vite scaffold)

- [ ] **Step 1: Scaffold Vite project**

```bash
npm create vite@latest pbb -- --template react-ts
cd pbb
npm install
```

Expected: `pbb/` exists with default Vite React-TS layout.

- [ ] **Step 2: Install runtime deps**

```bash
npm install convex openai @octokit/rest tar zod react-router-dom
```

- [ ] **Step 3: Install dev deps + Tailwind init**

```bash
npm install -D @types/tar tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

Expected: `tailwind.config.js` and `postcss.config.js` exist.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "scaffold vite react ts + deps"
```

---

### Task 2: Tailwind config + CSS entry

**Files:**
- Modify: `tailwind.config.js`
- Modify: `src/index.css`

- [ ] **Step 1: Replace `tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 2: Replace `src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 3: Commit**

```bash
git add tailwind.config.js src/index.css
git commit -m "tailwind setup"
```

---

### Task 3: Initialize Convex backend + push to GitHub

**Files:**
- Create: `convex/` (auto)
- Create: `.env.local` (auto)

- [ ] **Step 1: Run Convex dev (interactive — leave running in its own terminal)**

```bash
npx convex dev
```

When prompted: log in (already done), choose project name `pbb`. Wait until terminal prints `Convex functions ready!`. Leave running.

- [ ] **Step 2: In a NEW terminal, set OpenAI key**

```bash
npx convex env set OPENAI_API_KEY sk-your-key-here
```

Verify: `npx convex env list` shows `OPENAI_API_KEY`.

- [ ] **Step 3: Verify**

Open the Convex dashboard URL printed by `convex dev`. Confirm a working dashboard loads with no functions yet and empty Data tab.

- [ ] **Step 4: Push to GitHub**

```bash
git add -A
git commit -m "init convex backend"
gh repo create pbb --public --source=. --push
```

Verify: GitHub repo exists, public, current code pushed.

---

### Task 4: Install + register Workpool component

**Files:**
- Create: `convex/convex.config.ts`

- [ ] **Step 1: Install package**

```bash
npm install @convex-dev/workpool
```

- [ ] **Step 2: Create `convex/convex.config.ts`**

```ts
import { defineApp } from "convex/server";
import workpool from "@convex-dev/workpool/convex.config";

const app = defineApp();
app.use(workpool, { name: "agentPool" });
export default app;
```

- [ ] **Step 3: Verify**

Watch the `convex dev` terminal — it should reload, push, and end with `Convex functions ready!`. No errors.

- [ ] **Step 4: Commit**

```bash
git add convex/convex.config.ts package.json package-lock.json
git commit -m "register agentPool workpool component"
```

---

### Task 5: Schema (scans + findings tables)

**Files:**
- Create: `convex/schema.ts`

- [ ] **Step 1: Create `convex/schema.ts`**

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
```

- [ ] **Step 2: Verify**

Convex dashboard → Data tab shows two empty tables: `scans` and `findings`. `convex dev` terminal printed `Convex functions ready!` after schema push.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts
git commit -m "schema: scans + findings"
```

---

## Phase 2 — Backend

### Task 6: Prompts module (pure TS)

**Files:**
- Create: `convex/prompts.ts`

- [ ] **Step 1: Create `convex/prompts.ts`**

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

- [ ] **Step 2: Verify**

`convex dev` terminal pushes successfully. No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add convex/prompts.ts
git commit -m "prompts: 15 angles + agent/reducer templates"
```

---

### Task 7: Findings DB functions

**Files:**
- Create: `convex/findings.ts`

- [ ] **Step 1: Create `convex/findings.ts`**

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
    for (const id of discardedIds) {
      try {
        await ctx.db.patch(id as any, { reducerKept: false });
      } catch { /* finding may not exist if id was hallucinated */ }
    }
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

- [ ] **Step 2: Verify**

Convex dashboard → Functions tab shows `findings:byScan`, `findings:countsByAngle`, `findings:insertMany`, `findings:applyReducer`. No push errors.

- [ ] **Step 3: Commit**

```bash
git add convex/findings.ts
git commit -m "findings: queries + internal mutations"
```

---

### Task 8: Scans API

**Files:**
- Create: `convex/scans.ts`

- [ ] **Step 1: Create `convex/scans.ts`**

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

Note: `internal.orchestrator.run` and `internal.reducer.run` won't exist yet — `convex dev` will report unresolved imports until Tasks 11 and 13 land. That's expected; ignore until those tasks complete.

- [ ] **Step 2: Commit**

```bash
git add convex/scans.ts
git commit -m "scans: start mutation + status/progress mutations"
```

---

### Task 9: Repo download (Node module)

**Files:**
- Create: `convex/repo.ts`

- [ ] **Step 1: Create `convex/repo.ts`**

```ts
"use node";
// Node-only module: uses fs, tar, octokit. Imported by orchestrator.

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

export function parseGithubUrl(url: string): { owner: string; repo: string } {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git|\/|$)/);
  if (!m) throw new Error("Invalid GitHub URL");
  return { owner: m[1], repo: m[2] };
}

export async function downloadRepo(repoUrl: string): Promise<RepoFile[]> {
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

- [ ] **Step 2: Verify**

`convex dev` pushes without TS errors. `"use node";` is the literal first non-comment line of the file.

- [ ] **Step 3: Commit**

```bash
git add convex/repo.ts
git commit -m "repo: github tarball download + chunker"
```

---

### Task 10: Agent action

**Files:**
- Create: `convex/agents.ts`

- [ ] **Step 1: Create `convex/agents.ts`**

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

- [ ] **Step 2: Commit**

```bash
git add convex/agents.ts
git commit -m "agents: audit action with zod-validated openai call"
```

---

### Task 11: Internal queries split file

**Files:**
- Create: `convex/scans_internal.ts`

- [ ] **Step 1: Create `convex/scans_internal.ts`**

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

- [ ] **Step 2: Commit**

```bash
git add convex/scans_internal.ts
git commit -m "scans_internal: getInternal + findingsForReducer queries"
```

---

### Task 12: Orchestrator action

**Files:**
- Create: `convex/orchestrator.ts`

- [ ] **Step 1: Create `convex/orchestrator.ts`**

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
      await ctx.runMutation(internal.scans.setStatus, { scanId, status: "cloning" });
      const scan = await ctx.runQuery(internal.scans_internal.getInternal, { scanId });
      if (!scan) throw new Error("Scan disappeared");

      const files = await downloadRepo(scan.repoUrl);
      if (files.length === 0) throw new Error("No source files found in repo");

      type Task = { angleId: string; files: { path: string; content: string }[] };
      const tasks: Task[] = [];
      for (const angle of ANGLES) {
        const chunks = chunkFiles(files, angle.extensions);
        for (const chunk of chunks) {
          if (chunk.length > 0) tasks.push({ angleId: angle.id, files: chunk });
        }
      }
      if (tasks.length === 0) throw new Error("No applicable files for any angle");

      await ctx.runMutation(internal.scans.setTotalAgents, { scanId, total: tasks.length });
      await ctx.runMutation(internal.scans.setStatus, { scanId, status: "scanning" });

      for (const task of tasks) {
        await pool.enqueueAction(ctx, internal.agents.audit, {
          scanId,
          angleId: task.angleId,
          files: task.files,
        });
      }
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

- [ ] **Step 2: Verify**

`convex dev` push succeeds. `internal.scans.bumpProgress` reference in `agents.ts` and `internal.orchestrator.run` reference in `scans.ts` now both resolve.

- [ ] **Step 3: Commit**

```bash
git add convex/orchestrator.ts
git commit -m "orchestrator: build task matrix + enqueue into workpool"
```

---

### Task 13: Reducer action

**Files:**
- Create: `convex/reducer.ts`

- [ ] **Step 1: Create `convex/reducer.ts`**

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

- [ ] **Step 2: Verify**

`convex dev` ends with `Convex functions ready!`. Dashboard → Functions shows: `scans:start`, `scans:get`, `scans:setStatus`, `scans:setTotalAgents`, `scans:bumpProgress`, `scans_internal:getInternal`, `scans_internal:findingsForReducer`, `findings:byScan`, `findings:countsByAngle`, `findings:insertMany`, `findings:applyReducer`, `agents:audit`, `orchestrator:run`, `reducer:run`.

- [ ] **Step 3: Commit**

```bash
git add convex/reducer.ts
git commit -m "reducer: consolidate findings + mark scan done"
```

---

### Task 14: Backend smoke test (DO NOT SKIP)

**Files:** none.

- [ ] **Step 1: Trigger a scan from dashboard**

Dashboard → Functions → `scans:start` → "Run function" with arg:

```json
{ "repoUrl": "https://github.com/OWASP/NodeGoat" }
```

- [ ] **Step 2: Verify logs**

Within 2 minutes, dashboard Logs tab shows: `orchestrator:run` invocation, then many `agents:audit` invocations. No repeated red errors.

- [ ] **Step 3: Verify data**

Dashboard Data tab → `scans` row transitions: `pending` → `cloning` → `scanning` → `reducing` → `done`. `findings` table fills up. After `done`, several rows have `reducerRank` and `reducerSeverity` set; some have `reducerKept: false`.

- [ ] **Step 4: If failed — fix before UI**

Logs tab → click red entries → read stack trace → fix. Most likely causes (per spec):
- `Cannot find module '@convex-dev/workpool/convex.config'` → re-run `npm install @convex-dev/workpool` and restart `convex dev`.
- `internal.X.Y is not a function` → mismatched export type (`mutation` vs `internalMutation`, `action` vs `internalAction`).
- `tar` import fails → confirm `"use node";` is the literal first line of `repo.ts`.
- OpenAI returns prose, not JSON → confirm `response_format: { type: "json_object" }` is set.
- Workpool stuck → confirm `convex.config.ts` registers Workpool with `name: "agentPool"` matching `components.agentPool`.

Do not advance until smoke test passes.

---

## Phase 3 — UI Skeleton

### Task 15: Router + Convex provider entry

**Files:**
- Modify: `src/main.tsx`

- [ ] **Step 1: Replace `src/main.tsx`**

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

- [ ] **Step 2: Commit**

```bash
git add src/main.tsx
git commit -m "main: convex provider + router"
```

---

### Task 16: Home page

**Files:**
- Create: `src/pages/Home.tsx`

- [ ] **Step 1: Create `src/pages/Home.tsx`**

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

- [ ] **Step 2: Commit**

```bash
git add src/pages/Home.tsx
git commit -m "home: repo url form"
```

---

### Task 17: Scan page (skeleton)

**Files:**
- Create: `src/pages/Scan.tsx`

- [ ] **Step 1: Create `src/pages/Scan.tsx` (skeleton)**

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

- [ ] **Step 2: Commit**

```bash
git add src/pages/Scan.tsx
git commit -m "scan: skeleton page"
```

---

### Task 18: End-to-end smoke test (browser)

**Files:** none.

- [ ] **Step 1: Run dev server**

```bash
npm run dev
```

(Convex dev terminal must still be running.)

- [ ] **Step 2: Verify in browser**

Open the printed localhost URL. Paste `https://github.com/OWASP/NodeGoat`. Click Scan. Verify:
- Redirect to `/scan/<id>`.
- Status text updates `cloning` → `scanning` → `reducing` → `done` without manual refresh.
- Findings list appears and grows live.

- [ ] **Step 3: If broken — debug**

Common (per spec):
- Stuck on `Loading…` → browser console: `VITE_CONVEX_URL` missing in `.env.local`.
- `useQuery` returns `undefined` → loading state, render spinner; once data arrives it'll be array/object.
- Scan stuck at `cloning` → check Convex Logs tab for orchestrator stack trace.

Do not advance until end-to-end works.

---

## Phase 4 — UI Polish

### Task 19: Severity badge

**Files:**
- Create: `src/components/SeverityBadge.tsx`

- [ ] **Step 1: Create `src/components/SeverityBadge.tsx`**

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

- [ ] **Step 2: Commit**

```bash
git add src/components/SeverityBadge.tsx
git commit -m "ui: severity badge"
```

---

### Task 20: Angle grid

**Files:**
- Create: `src/components/AngleGrid.tsx`

- [ ] **Step 1: Create `src/components/AngleGrid.tsx`**

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

- [ ] **Step 2: Commit**

```bash
git add src/components/AngleGrid.tsx
git commit -m "ui: angle grid"
```

---

### Task 21: Findings table

**Files:**
- Create: `src/components/FindingsTable.tsx`

- [ ] **Step 1: Create `src/components/FindingsTable.tsx`**

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

- [ ] **Step 2: Commit**

```bash
git add src/components/FindingsTable.tsx
git commit -m "ui: findings table with collapsible rows"
```

---

### Task 22: Polished Scan page

**Files:**
- Modify: `src/pages/Scan.tsx`

- [ ] **Step 1: Replace `src/pages/Scan.tsx`**

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

- [ ] **Step 2: Verify (browser)**

Run another scan. Confirm:
- Status badge color changes through statuses.
- Progress bar fills `0% → 100%`.
- Angle grid cells turn green as findings arrive in each angle.
- Findings stream in.
- After `done`: list re-sorts by reducer rank, "· ranked" appears in header, merged duplicates disappear.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Scan.tsx
git commit -m "scan: polished view with angle grid + findings table"
```

---

## Phase 5 — Hardening + Demo Rehearsal

### Task 23: Full-scan timing pass

**Files:** none (or tweaks below).

- [ ] **Step 1: Run a clean scan on NodeGoat**

In browser: paste `https://github.com/OWASP/NodeGoat`, click Scan, time it with a stopwatch.

Expected: 60–120 seconds end-to-end.

- [ ] **Step 2: If >3 min — drop parallelism floor or file budget**

Edit `convex/orchestrator.ts`: change `maxParallelism: 20` → `maxParallelism: 15`.

OR edit `convex/repo.ts`: change `const MAX_FILES = 200;` → `const MAX_FILES = 100;`.

- [ ] **Step 3: If 0 findings — check key + parse errors**

```bash
npx convex env list
```

Confirm `OPENAI_API_KEY` set. Then dashboard Logs → look for zod parse failures or OpenAI errors.

- [ ] **Step 4: If 429s — enable retries**

Edit `convex/orchestrator.ts` Workpool config:

```ts
const pool = new Workpool(components.agentPool, {
  maxParallelism: 20,
  retryActionsByDefault: true,
});
```

- [ ] **Step 5: Take screenshot of finished dashboard**

Save to `docs/demo-screenshot.png`.

- [ ] **Step 6: Commit any tweaks**

```bash
git add -A
git commit -m "tune: parallelism / retries for demo"
```

---

### Task 24: Pitch rehearsal

**Files:** none.

- [ ] **Step 1: Rehearse 60-second pitch**

1. Open Convex dashboard in window 2.
2. Paste NodeGoat URL, click Scan.
3. Say: "150 agents firing in parallel — 15 attack angles × ~10 file chunks. Convex Workpool enforces concurrency=20."
4. Point at dashboard: "Each dot is a real function invocation."
5. Findings tick in. Click a critical one. Show evidence.
6. "Reducer dedupes and ranks." Show ranked list.
7. "Sequential: 10+ minutes. This: 90 seconds. The depth is the orchestration."

- [ ] **Step 2: Time it**

Must fit in 60 seconds. If longer — cut detail, not the parallel-vs-sequential punchline.

---

## Phase 6 — README + Final Push

### Task 25: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace `README.md`**

```md
# Parallel Bug Bounty

50–200 Codex agents fan out in parallel to audit any public GitHub repo for vulnerabilities.

## Architecture

```
Browser ──WS── Convex ──schedule──> orchestrator (Node)
                                       │
                                       └──enqueue × N──> Workpool ──> agent (Node) ──> OpenAI
                                                                          │
                                                                          └─runMutation─> findings table
                                                                                              │
                                                  (last agent fires reducer) ─────────────────┘
```

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

- [ ] **Step 2: Commit + push**

```bash
git add README.md
git commit -m "polish: readme"
git push
```

---

## Phase 7 — Buffer (only if everything green)

### Task 26: Stretch goals (optional — STOP at 3:30)

**Files:** depends on stretch chosen.

- [ ] **Step 1: Choose at most one stretch** (per spec):
  1. "Re-run reducer" button — frontend mutation that schedules `internal.reducer.run` on demand.
  2. File-tree heatmap — group findings by directory, render colored treemap.
  3. SARIF export — a public query that returns findings in SARIF JSON.

- [ ] **Step 2: Hard stop at 3:30**

Do not ship a half-broken stretch goal at 3:55. If unfinished by 3:30, revert and rehearse pitch again.

```bash
git stash   # if unfinished, stash and walk away
```

---

## Common Errors → Fixes (reference)

Mirror of spec table — keep handy during execution:

| Error | Fix |
|---|---|
| `Cannot find module '@convex-dev/workpool/convex.config'` | Run `npm install @convex-dev/workpool`. Restart `convex dev`. |
| `internal.X.Y is not a function` | Function exported as `mutation`/`action`, not `internalMutation`/`internalAction` (or vice-versa). |
| `tar` import fails in Convex | Confirm file starts with `"use node";` on its own first line. |
| OpenAI returns prose instead of JSON | Confirm `response_format: { type: "json_object" }` is set. |
| Frontend stuck on `Loading…` | Browser console; check `VITE_CONVEX_URL` in `.env.local`. |
| `useQuery` returns `undefined` | Loading state — render a spinner; data arrives after WS round-trip. |
| Scan stuck at `cloning` | Repo too big or invalid URL. Check Convex Logs for orchestrator error. |
| Schema validation error on insert | Finding's `severity` outside 1–10, or `lineStart` missing. Zod should catch — confirm it ran. |
| `_generated` types missing | `convex dev` not running or hasn't pushed. Save any `convex/` file to retrigger. |
| Workpool stuck, agents not running | Confirm `convex.config.ts` registers Workpool with `name: "agentPool"` matching `components.agentPool`. |

---

## The One Rule

**Don't move to a new phase until the previous phase's verification step passes.** Cascading errors cost more than slow progress. End-to-end working ugly demo by 2 PM beats beautiful broken demo at 4 PM.
