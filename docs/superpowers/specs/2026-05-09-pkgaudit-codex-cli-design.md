# pkgaudit — npm supply-chain audit CLI (Codex-driven)

**Date:** 2026-05-09
**Status:** Design approved, awaiting implementation plan
**Hackathon:** Weekend Build with Codex, HCMC

## Goal

Local CLI that audits the transitive dependency tree of a `package.json` for supply-chain malice (malicious postinstall scripts, obfuscated payloads, credential exfil, typosquats, etc.) by orchestrating parallel Codex CLI agents — one per package.

## Pivot context

This project began as a generic AppSec scanner ("Parallel Bug Bounty") with a Convex backend, React UI, and 15 attack-angle agents per repo. Two pivots reduced scope:

1. **Niche down to npm supply-chain.** Generic AppSec is crowded (Snyk, Semgrep, GHAS); supply-chain malice in npm packages is a narrower target where LLM reasoning beats pattern matchers.
2. **Drop the web stack; ship a CLI.** Convex + React adds infrastructure overhead with no demo benefit for a single-machine audit. A CLI runs locally with `OPENAI_API_KEY`, integrates into developer workflows, and aligns with the Codex CLI tooling theme of the event.

The Convex/Vite scaffold is left dormant in the repo (not deleted) in case a future pivot revives it.

## Scope (in)

- Read a `package.json` from CWD or an explicit path argument
- Resolve transitive dependencies via the npm registry (BFS, hard cap of 20 packages for proof-of-concept)
- Download each package's tarball from `registry.npmjs.org`
- Extract to a tempdir; never run lifecycle scripts
- Spawn one Codex CLI subprocess per package, in read-only sandbox mode, with concurrency capped at 20
- Each Codex agent emits a fenced JSON verdict (`malicious | suspicious | clean`) plus structured findings
- Aggregate verdicts; render a pretty terminal report (default) or raw JSON (`--json`)
- Exit code reflects worst verdict: `0` clean, `1` suspicious, `2` malicious

## Scope (out)

- Resolving lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`). v1 reads `dependencies` + `devDependencies` from the input `package.json` and resolves to latest matching the declared range via the registry. Lockfile support is a future enhancement.
- Caching across runs. Each invocation re-fetches and re-audits. Acceptable for a 20-package cap.
- Cross-package correlation (e.g., shared obfuscation signatures across packages). Each package is audited in isolation.
- A backend, web UI, persistence, multi-user support, or auth.

## Architecture

```
$ pkgaudit ./package.json
        │
        ▼
  parse package.json ──► direct deps {name, range}[]
        │
        ▼
  resolveTransitive (BFS over registry.npmjs.org, dedupe, cap 20)
        │
        ▼
  packages: {name, version, depth, parent}[]
        │
        ▼
  p-limit(20).map(packages, auditOne)
        │      ┌──────────────────────────────────────────┐
        ├─────►│  fetchTarball → extract to /tmp/<scan>/  │
        │      │           │                              │
        │      │           ▼                              │
        │      │  spawn("codex", ["exec",                 │
        │      │     "--cd", extractedDir,                │
        │      │     "--sandbox", "read-only",            │
        │      │     AUDIT_PROMPT])                       │
        │      │           │                              │
        │      │           ▼                              │
        │      │  parse fenced JSON from stdout           │
        │      │           │                              │
        │      │           ▼                              │
        │      │  zod-validate → PackageReport            │
        │      └──────────────────────────────────────────┘
        ▼
  aggregate → render (text or JSON) → exit code
```

## Process flow per package

1. **Fetch.** `GET https://registry.npmjs.org/<name>/-/<name>-<version>.tgz`. Stream to `/tmp/pkgaudit-<scanId>/<safeName>-<version>.tgz`. Tarball cap: 5 MB compressed (skip and mark `error: too_large` if exceeded).
2. **Extract.** `tar.x({ strip: 1 })` into `/tmp/pkgaudit-<scanId>/<safeName>-<version>/`. The registry wraps every tarball under a top-level `package/` directory; `strip: 1` collapses it so the extracted root contains the package's own files (`package.json`, `index.js`, …).
3. **Spawn Codex.** `child_process.spawn("codex", [...args, AUDIT_PROMPT], { env: process.env })`. Inherit `OPENAI_API_KEY`. No shell. Args sanitized — package names from the registry, but we still quote/escape defensively. Capture stdout + stderr; impose a 90-second per-package timeout (kill the subprocess if exceeded; mark `error: timeout`).
4. **Parse.** Extract the last fenced ```` ```json … ``` ```` block from stdout. Parse, then zod-validate against `PackageReportSchema` (below). On parse/validation failure: mark `error: parse_failed`, attach raw stdout for debug.
5. **Record.** Push the result onto an in-memory results array. Update stderr progress line.

After all packages settle, render the aggregated report.

## Codex CLI invocation

```ts
spawn("codex", [
  "exec",
  "--cd", extractedDir,
  "--sandbox", "read-only",
  "--model", "gpt-5-codex",     // or whatever default ships; configurable via --model flag
  AUDIT_PROMPT,
], {
  env: { ...process.env },       // inherits OPENAI_API_KEY
  stdio: ["ignore", "pipe", "pipe"],
});
```

Read-only sandbox is non-negotiable: target packages may contain real malware. Codex must read files but not execute them, write to disk, or make network calls.

If the installed Codex CLI uses different flag names (e.g. `--cwd` instead of `--cd`, or a different sandbox flag), the abstraction lives in a single function (`spawnCodex` in `src/audit.ts`); update flags there.

## Audit prompt

The full prompt is plain text passed as a single argv to `codex exec`. Prompt skeleton:

```
You are a supply-chain malware auditor for npm packages.

Package: <name>@<version>
Working directory: the extracted tarball contents (you can read any file).

Audit ONLY for genuine supply-chain malice. Categories:
- postinstall_exec: install/preinstall/postinstall hooks that execute code beyond build
- obfuscation: eval/Function/base64/hex/charCode-array decode-and-execute chains
- exfil: outbound network calls to non-obvious hosts (DNS, HTTP, WS) at install or runtime
- fs_access: reads of ~/.ssh, ~/.aws/credentials, .env, browser cookies, OS keychains
- proc_spawn: child_process.exec/spawn with non-build arguments
- typosquat: name resembles a popular package (react, lodash, express, axios, ...) and the package was published recently with low downloads
- dyn_require: require() called with a runtime-built or decoded string
- install_runtime_mismatch: package advertises as a runtime library but does substantial work at install time
- wallet_hijack: tampers with web3 / window.ethereum / wallet provider APIs
- other: anything else that is unambiguously malicious

Do NOT report style issues, code smells, generic AppSec bugs (XSS/SQLi in source), or hypothetical concerns.

Verdicts:
- malicious: clear evidence of intentional harm
- suspicious: anomalous patterns that warrant review but no smoking gun
- clean: nothing concerning

Respond with exactly one fenced JSON block matching this schema:

```json
{
  "verdict": "malicious" | "suspicious" | "clean",
  "riskScore": <integer 1-10>,
  "summary": "<one sentence>",
  "findings": [
    {
      "category": "<one of the categories above>",
      "severity": <integer 1-10>,
      "title": "<one-line>",
      "description": "<2-3 sentences>",
      "evidence": "<exact code snippet, max 10 lines>",
      "file": "<relative path>",
      "lineStart": <integer>,
      "lineEnd": <integer>
    }
  ]
}
```

If clean, return `findings: []`. Output ONLY the fenced JSON block — no prose before or after.
```

## JSON contract + parsing

Codex output may include reasoning traces, tool-call summaries, or chatter. We rely on the fenced block to isolate the verdict.

Parser (`parseCodexOutput`):

1. Match all ```` ```json\n([\s\S]*?)\n``` ```` blocks in stdout.
2. Take the last match (Codex may emit intermediate JSON during reasoning).
3. `JSON.parse` it.
4. `PackageReportSchema.safeParse` it.
5. Failure path → `{ error: "parse_failed", rawStdout, parseError }`.

## File layout

```
hackathon/
├── convex/                       # dormant, untouched
├── src/                          # dormant frontend, untouched
├── cli/                          # ★ new
│   ├── cli.ts                    # entry point, shebang, argv parsing, env check, main
│   ├── resolve.ts                # parsePackageJson, resolveTransitive (BFS, cap)
│   ├── fetch.ts                  # downloadTarball, extractTarball
│   ├── prompt.ts                 # AUDIT_PROMPT template, PackageReportSchema (zod)
│   ├── audit.ts                  # auditOne, spawnCodex, parseCodexOutput
│   ├── report.ts                 # renderText, renderJson, exitCodeFor
│   └── types.ts                  # shared TS types
├── tsconfig.cli.json             # ★ new — node-targeted, separate from existing tsconfigs
├── package.json                  # ★ updated — add `bin`, scripts, cli deps
└── README.md                     # ★ updated — pkgaudit usage replaces parallel-bug-bounty
```

`bin` entry in `package.json`:

```json
{
  "bin": { "pkgaudit": "./cli/cli.ts" },
  "scripts": {
    "cli": "tsx cli/cli.ts",
    "build:cli": "tsc -p tsconfig.cli.json"
  }
}
```

For the demo, run via `npm run cli -- ./fixtures/demo-package.json`. A real `npm install -g .` install path is a stretch goal.

## Module contracts

### `cli.ts`

```ts
async function main(argv: string[]): Promise<number>
```

- Parse argv: positional `[packageJsonPath]` (default `./package.json`), flags `--json`, `--max <n>` (default 20), `--model <id>` (default Codex's default), `--help`.
- Verify `OPENAI_API_KEY` is set; if missing, print error to stderr and return 1.
- Verify `codex` is on PATH; if missing, print install hint and return 1.
- Read + parse package.json.
- Call `resolveTransitive`.
- Call `auditAll`.
- Call `renderText` or `renderJson`.
- Return `exitCodeFor(results)`.

### `resolve.ts`

```ts
type DepRange = { name: string; range: string };
type ResolvedPkg = { name: string; version: string; depth: number; parent: string | null };

function parsePackageJson(text: string): { name?: string; deps: DepRange[] };
async function resolveTransitive(direct: DepRange[], opts: { cap: number }): Promise<{ packages: ResolvedPkg[]; resolvedCount: number }>;
```

`resolveTransitive` does BFS:

1. Queue starts with direct deps at depth 0.
2. Pop one; if `seen.has(name@version)`, skip. Else: `GET https://registry.npmjs.org/<name>`, pick `semver.maxSatisfying(versions, range)`.
3. Push to results; if `results.length >= cap`, break and return `resolvedCount` as the total enqueued (informational; we report "47 deps resolved · 20 audited").
4. Enqueue that version's `dependencies` (skip `devDependencies` — only the root package's devDeps are audited).
5. On registry error (404, network), record the package with a synthetic `error: registry_unreachable` and skip its children.

### `fetch.ts`

```ts
async function downloadTarball(name: string, version: string, destDir: string): Promise<string>;  // returns tarball path
async function extractTarball(tarballPath: string, destDir: string): Promise<string>;             // returns extracted dir
```

Tarball URL: registry's resolved `dist.tarball` URL (fetched as part of the metadata in `resolveTransitive`; pass it through to avoid a second registry call). Fall back to `https://registry.npmjs.org/<name>/-/<basename>-<version>.tgz` if absent.

Tarball size cap: 5 MB. Stream-check `Content-Length` header first; if absent, count bytes during streaming and abort if exceeded.

### `prompt.ts`

```ts
export const AUDIT_PROMPT_TEMPLATE: (pkg: ResolvedPkg) => string;
export const PackageReportSchema: z.ZodType<PackageReport>;
```

### `audit.ts`

```ts
type AuditResult =
  | { kind: "ok"; pkg: ResolvedPkg; report: PackageReport }
  | { kind: "error"; pkg: ResolvedPkg; reason: string; raw?: string };

async function auditOne(pkg: ResolvedPkg, opts: { model?: string; tmpRoot: string; onProgress: (status: string) => void }): Promise<AuditResult>;
async function auditAll(pkgs: ResolvedPkg[], opts: { concurrency: number; model?: string }): Promise<AuditResult[]>;
function spawnCodex(extractedDir: string, prompt: string, opts: { model?: string; timeoutMs: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
function parseCodexOutput(stdout: string): { ok: true; report: PackageReport } | { ok: false; reason: string };
```

`auditAll` uses `p-limit(opts.concurrency)`. Failures don't abort the run — they become `AuditResult{ kind: "error" }` entries.

### `report.ts`

```ts
function renderText(results: AuditResult[], meta: { resolvedCount: number; cap: number }): string;
function renderJson(results: AuditResult[], meta: { resolvedCount: number; cap: number }): string;
function exitCodeFor(results: AuditResult[]): 0 | 1 | 2;
```

Exit code: `2` if any `malicious`, else `1` if any `suspicious` or `error`, else `0`.

## zod schema

```ts
const FindingSchema = z.object({
  category: z.enum([
    "postinstall_exec", "obfuscation", "exfil", "fs_access", "proc_spawn",
    "typosquat", "dyn_require", "install_runtime_mismatch", "wallet_hijack", "other",
  ]),
  severity: z.number().int().min(1).max(10),
  title: z.string().max(200),
  description: z.string().max(1000),
  evidence: z.string().max(2000),
  file: z.string().optional(),
  lineStart: z.number().int().nonnegative().optional(),
  lineEnd: z.number().int().nonnegative().optional(),
});

const PackageReportSchema = z.object({
  verdict: z.enum(["malicious", "suspicious", "clean"]),
  riskScore: z.number().int().min(1).max(10),
  summary: z.string().max(500),
  findings: z.array(FindingSchema),
});
```

## Live progress (stderr)

When stdout is not in JSON mode and stderr is a TTY, render a moving status block:

```
[ 3/20] event-stream@3.3.6     ✗ MALICIOUS
[ 4/20] lodash@4.17.21         ✓ clean
[ 5/20] ua-parser-js@0.7.29    ⠋ auditing...
```

Update lines in place via cursor moves; if not a TTY (CI, redirected), append plain lines. If `--json`, suppress entirely.

## Pretty text report (stdout)

```
pkgaudit · 47 deps resolved · 20 audited · 92s

MALICIOUS (2)
  event-stream@3.3.6                              risk 10/10
    Loads encrypted payload from flatmap-stream sub-dependency that targets
    bitcoin wallet libraries.
    • postinstall_exec   index.js:42-58
    • obfuscation        index.js:71-85
  ua-parser-js@0.7.29                             risk 9/10
    preinstall script downloads and executes external binary.
    • proc_spawn         preinstall.sh:3
    • exfil              preinstall.sh:7

SUSPICIOUS (1)
  some-pkg@1.2.3                                  risk 6/10
    Dynamic require with base64-decoded module name.
    • dyn_require        loader.js:12

CLEAN (15)
  lodash@4.17.21, react@18.2.0, semver@7.5.4, ...

ERRORS (2)
  flaky-pkg@1.0.0   parse_failed (use --json to see raw output)
  big-pkg@2.0.0     too_large (tarball > 5 MB)

exit 2 (malicious)
```

## JSON report (`--json`)

```json
{
  "meta": { "resolvedCount": 47, "audited": 20, "elapsedMs": 92000 },
  "results": [
    { "kind": "ok", "pkg": { "name": "event-stream", "version": "3.3.6", "depth": 1, "parent": "some-direct-dep" },
      "report": { "verdict": "malicious", "riskScore": 10, "summary": "...", "findings": [...] } },
    { "kind": "error", "pkg": { ... }, "reason": "too_large" }
  ],
  "summary": { "malicious": 2, "suspicious": 1, "clean": 15, "errors": 2 },
  "exitCode": 2
}
```

## Demo target

A demo `package.json` fixture lives at `cli/fixtures/demo-package.json` with one or two historically-malicious pinned versions mixed with normal deps. Candidates to verify still resolve from the registry on demo day (May 9 2026):

- `event-stream@3.3.6` (2018 flatmap-stream backdoor)
- `ua-parser-js@0.7.29` (2021 hijack)
- `coa@2.0.3`, `rc@1.2.9` (2021 hijacks)

Verification step on demo morning: `curl -s https://registry.npmjs.org/event-stream/3.3.6 | jq .dist.tarball` to confirm the malicious version is still served. If the registry has scrubbed all of them, fall back to a synthetic fixture: a local fake-malicious package shipped in the repo whose name resolves through a custom registry override (`--registry file://...`). Adding a `--registry` flag is a stretch goal; the simpler fallback is a doctored fixture that the resolver reads from disk via a `file:` protocol prefix on the dep name.

## Error handling

| Failure | Behavior |
| --- | --- |
| `OPENAI_API_KEY` unset | Print error, exit 1, before any work. |
| `codex` not on PATH | Print install hint (`brew install openai-codex` or whatever current install path is), exit 1. |
| Bad `package.json` path | Print error, exit 1. |
| Registry 404/network on a single package | Record `error: registry_unreachable`, continue other packages. |
| Tarball >5 MB | Record `error: too_large`, skip. |
| `tar` extraction failure | Record `error: extract_failed`, skip. |
| Codex subprocess timeout (>90 s) | Kill, record `error: timeout`, skip. |
| Codex non-zero exit | Record `error: codex_failed`, attach stderr tail. |
| JSON not found / zod validation fails | Record `error: parse_failed`, attach raw stdout (truncated to 2 KB). |

A package error never aborts the run. The exit code reflects the worst observed verdict + presence of any errors.

## Testing strategy

- **Unit:** `parsePackageJson`, `parseCodexOutput`, `exitCodeFor`, semver picking — pure functions, vitest.
- **Integration (no network):** `auditOne` against a recorded Codex stdout fixture (capture once, replay). `spawnCodex` is mocked.
- **End-to-end (manual, demo morning):** Run against `cli/fixtures/demo-package.json` with real Codex; confirm it flags the known-bad pin within the time budget.

No CI integration in v1.

## Risks + mitigations

- **Codex CLI flag drift.** Risk: invocation flags (`--cd`, `--sandbox`) may not match installed version. Mitigation: isolate in `spawnCodex`; on demo morning, run `codex exec --help` and adjust before showtime.
- **Codex output format drift.** Risk: fenced JSON parsing fails because Codex wraps differently. Mitigation: the prompt is explicit about the fence; parser tolerates leading/trailing chatter; on parse failure, raw output is preserved for inspection.
- **Slow Codex per-call.** Risk: 90-second timeout fires for some packages; demo cadence suffers. Mitigation: 90s is generous; if still slow, drop the per-package budget, reduce max files Codex sees, or downshift the model.
- **Registry cleanup.** Risk: malicious historical versions are no longer served. Mitigation: verified the morning of; doctored fixture as fallback.
- **Live-running malicious code by accident.** Risk: malicious tarballs contain `postinstall` hooks. Mitigation: we never run `npm install`. We extract tarballs with `tar.x` (purely a file-write operation; no script execution) and pass them to Codex in read-only sandbox mode. Tempdir is under `/tmp/pkgaudit-<scanId>/` and is rm-rf'd on exit.

## Stretch (not v1)

- Lockfile resolution (deterministic versions across machines)
- Result caching keyed on `(name, version, prompt-hash, model)`
- `--registry <url>` for private registry support
- Cross-package correlation pass (a second Codex agent reduces individual reports into a tree-level summary)
- HTML report export
- GitHub Action wrapper
