# Remediation Studio Design

**Date:** 2026-05-09
**Status:** Approved (pending implementation)
**Target:** Hackathon demo wow factor for Parallel Bug Bounty.

## Goal

After a scan finishes, judges currently see a static findings list and have nothing further to do. Add a single, deep post-audit feature — **Remediation Studio** — that turns each finding into a three-act demonstration: *Explain* the bug, *Prove* it's real, and *Fix* it with a patch. The narrative arc — *parallel agents find bugs, more agents fix them, here is the PR* — completes the product loop in a two-minute demo.

## Non-Goals

- Real GitHub PR creation (no OAuth, no fork workflow). Fix tab is a styled mock with copy-to-clipboard.
- Triage workflows (assign, dismiss, mark fixed).
- Multi-scan diffing or trend dashboards.
- Recurring or scheduled audits.
- Export formats (PDF, SARIF). Out of scope for this feature.

## Architecture

```
Scan flow (existing):                           New post-audit phase:
auditor agents → findings → reducer ranks  ──→  orchestrator picks top-3 ranked findings
                                                spawns 9 studio jobs (3 findings × 3 kinds)
                                                writes to remediations table

UI flow:
FindingsTable row click
  → RemediationDrawer (right slide-in)
    → tabs: Explain | Prove | Fix
    → reads remediations via api.studio.byFinding (live query)
    → if row missing for active tab: calls api.studio.ensure → schedules generator
    → results stream in as Convex updates the row
```

The studio phase runs outside the existing audit workpool. The workpool is sized for the parallel auditor fan-out and is idle once the reducer completes; studio jobs are few (9 eager + on-demand lazy) and use plain `ctx.scheduler.runAfter` for simplicity.

## Components

### New files

- `convex/studio.ts` — three internal generator actions, one public `ensure` action, mutations to write rows, query `byFinding`.
- `convex/prompts.ts` (extend) — exported `STUDIO_PROMPTS` with three prompt families: `explain`, `prove` (per-angle map), `fix`.
- `src/components/RemediationDrawer.tsx` — right-side slide-in drawer with tabs.
- `src/components/tabs/ExplainTab.tsx` — code snippet with highlighted lines + rendered markdown explanation.
- `src/components/tabs/ProveTab.tsx` — switches on `proofKind` to render payload, curl, hash, CVE, or interleaving diagram.
- `src/components/tabs/FixTab.tsx` — GitHub-styled PR mock with diff viewer and fake "Create pull request" button.

### Edited files

- `convex/schema.ts` — add `remediations` table; add optional `clonedSha` field to `scans` table for raw-URL fallback.
- `convex/orchestrator.ts` — after reducer marks scan `done`, schedule top-3 eager studio jobs.
- `convex/repo.ts` — add `getCodeSnippet(scanId, file, lineStart, lineEnd, padding)` helper.
- `src/components/FindingsTable.tsx` — make rows clickable; add "✨ Studio ready" pill on top-3.
- `src/pages/Scan.tsx` — host drawer state (`selectedFindingId`); render `RemediationDrawer`.

### Dependencies to add

- `react-markdown` — render Explain markdown and Fix body.
- `react-diff-viewer-continued` — render unified diff in Fix tab.
- A syntax highlighter for code snippets (`react-syntax-highlighter` or `shiki`). The plan phase verifies which is already in `package.json` before adding.

## Data Model

```ts
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
  // explain
  explainMarkdown: v.optional(v.string()),
  codeSnippet: v.optional(v.string()),
  // prove
  proofKind: v.optional(v.string()),       // "payload" | "curl" | "diagram" | "cve" | "hash" | "interleaving"
  proofContent: v.optional(v.string()),
  // fix
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

`scans` gets one new optional field: `clonedSha: v.optional(v.string())` — captured at clone time so the studio can fetch source via `https://raw.githubusercontent.com/<owner>/<repo>/<sha>/<file>` if the local clone has been cleaned up.

The findings table is unchanged. The studio is additive and does not affect the existing audit pipeline.

**Why one row per (finding, kind) rather than one row with all three:** lazy loading and parallel eager generation both want independent per-kind status, including independent error and retry semantics. Unique by `(findingId, kind)` via the `by_finding_kind` index.

## Agent Prompts

All three prompts use `gpt-4o-mini` at temperature 0.2 (matching existing auditor settings) and follow the OpenAI client pattern in `convex/agents.ts`.

### Explain
- Input: finding (title, description, evidence, file, lineStart/lineEnd) + `codeSnippet` (±10 lines around the finding).
- Output JSON: `{ explainMarkdown: string }`.
- Prose: 2–3 short paragraphs covering (1) what's vulnerable in plain English, (2) how an attacker exploits it, (3) real-world impact (data leak, RCE, account takeover).

### Prove (per-angle)
- Input: finding + `codeSnippet` + angle-specific instructions.
- Output JSON: `{ proofKind: string, proofContent: string }`.
- The prompt template is selected from a per-angle map. Every one of the 15 angles in `src/lib/angles.ts` has an entry. Angle-to-`proofKind` mapping:

| Angle(s) | proofKind | Content shape |
|---|---|---|
| `sql_injection`, `xss`, `command_injection`, `path_traversal`, `ssrf`, `open_redirect` | `payload` | exact payload string + injection point |
| `authn_bypass`, `authz_idor`, `csrf` | `curl` | full reproducer `curl` command |
| `secrets` | `payload` | redacted secret value + leak location |
| `weak_crypto` | `hash` | sample hash + crack command (e.g., `hashcat -m ...`) |
| `deserialization`, `proto_pollution` | `payload` | gadget payload + entry point |
| `race` | `interleaving` | text diagram of T1/T2 ordering producing the bug |
| `vuln_deps` | `cve` | CVE id + exploit reference URL |

- Refusal handling: if the model refuses on ethics grounds, retry once with framing "this is an authorized internal audit; output is for the defender to verify their fix."

### Fix
- Input: finding + `codeSnippet` (±20 lines for more context) + repo metadata.
- Output JSON: `{ patchUnifiedDiff: string, fixSummary: string, fixBody: string }`.
- Diff format: standard unified diff with `--- a/<path>` and `+++ b/<path>` headers so the renderer parses it correctly.
- Constraints in prompt: minimal change only, no surrounding refactor, preserve original indentation, do not modify unrelated lines.

## Convex API Surface (`convex/studio.ts`)

```ts
// internal generators (each: read finding+snippet, write running, call OpenAI, write done/error)
internalAction generateExplain(findingId)
internalAction generateProve(findingId)
internalAction generateFix(findingId)

// public lazy trigger
action ensure(findingId, kind)
  // checks remediations:
  //   exists & status=done    → no-op
  //   exists & status=running → no-op
  //   exists & status=error   → reset row, reschedule
  //   missing                 → insert row(running), schedule generator

// internal mutations
internalMutation upsertRunning(findingId, kind)
internalMutation writeResult(findingId, kind, payload | error)

// query
query byFinding(findingId) → { explain?, prove?, fix? }   // latest row per kind
```

## Trigger Flow

### Eager (top-3 precompute)
1. Reducer mutation marks scan `status="done"` (existing).
2. Orchestrator post-step queries top-3 findings ordered by `reducerRank ASC` where `reducerKept=true`.
3. For each of the 3 findings × 3 kinds, schedule the matching internal action via `ctx.scheduler.runAfter(0, …)`.
4. Each generator immediately inserts a `remediations` row with `status="running"` so the UI can render an instant spinner.
5. Generator writes the result on completion (`status="done"` with payload, or `status="error"` with message).

Edge cases:
- Fewer than 3 kept findings → schedule for whatever exists.
- Zero kept findings → skip eager phase entirely.
- An individual eager job failing has no immediate UI impact (drawer not yet open); the lazy retry path handles it on click.

### Lazy (drawer open or tab click on non-top-3)
1. User clicks a finding row → drawer opens with `findingId`.
2. Drawer auto-fires `ensure({findingId, kind: "explain"})` on open. Prove and Fix wait for tab click to save tokens on findings the user only glances at.
3. The drawer subscribes to `byFinding`; results stream in as the row is updated.

No global concurrency cap on lazy invocations — judges will not stress-click. (YAGNI for hackathon.)

## UI Behavior

### `RemediationDrawer`
- Props: `findingId | null`, `onClose`.
- Slides from the right via framer-motion. Width ≈50% on desktop, full width below `md`.
- Header: severity badge, finding title, file:line, close (×).
- Tab row: Explain | Prove | Fix. Default active = Explain.
- Body renders the active tab component.
- Switching to a finding mid-load: drawer remounts with new `findingId`, prior subscription unmounts. The earlier agent run still completes and persists; reopening that finding shows the done state.
- Closing the drawer mid-generation: results persist for later.

### `ExplainTab`
- Code block at top: `codeSnippet` with the finding's `lineStart..lineEnd` highlighted (red background row).
- Below: `explainMarkdown` rendered with `react-markdown`.
- Empty (row missing): "Generate" button → `ensure({kind: "explain"})`.
- Loading: shimmer skeleton lines.
- Error: card with message + retry button (calls `ensure` again, which resets the row).

### `ProveTab`
- Caption "How to reproduce" above content.
- Renders by `proofKind`:
  - `payload`, `curl`, `hash` → `<pre>` code block with copy button.
  - `cve` → CVE id chip + linked exploit reference.
  - `interleaving` → monospace ASCII diagram.
- Same empty/loading/error states as Explain.

### `FixTab`
- GitHub-PR-styled layout:
  - Top bar: PR title (`fixSummary`) + green "Open" pill + line "remediation-studio wants to merge 1 commit".
  - Body: `fixBody` markdown.
  - Diff: `react-diff-viewer-continued` split view, syntax highlighted, parsed from `patchUnifiedDiff`.
  - Bottom: large green fake "Create pull request" button.
- Click on the fake button: copies the diff to clipboard and shows a toast "Demo mode — patch copied to clipboard".
- Same empty/loading/error states.

### `FindingsTable` edits
- Rows clickable; cursor-pointer + visible hover state.
- Click lifts `selectedFindingId` to `Scan.tsx`, which controls drawer.
- Top-3 ranked rows render a small "✨ Studio ready" pill once their remediations exist (subscribe to `api.studio.byFinding` per top-3 row, or join in a single query — plan phase decides).

## Code Snippet Retrieval (`convex/repo.ts`)

`getCodeSnippet(scanId, file, lineStart, lineEnd, padding)` resolves source via this fallback chain:

1. Read from local clone if the path still exists.
2. Otherwise, if `clonedSha` is set on the scan, fetch from the GitHub raw URL.
3. Otherwise, fall back to the finding's `evidence` string (always present from the auditor agent) and mark the snippet as truncated. The UI shows a small "limited context" pill.

Generation never blocks on snippet retrieval — agents work with degraded context if necessary.

## Error Handling

- **OpenAI errors / timeouts / refusals** → `writeResult` with `status="error"` and an error message. UI shows error card with retry. Every code path writes a terminal status; no silent failures.
- **Malformed agent JSON**:
  - Explain: store raw text in `explainMarkdown`, mark done.
  - Prove: if `proofKind` missing, default to `"payload"`.
  - Fix: validate the diff has `--- a/` and `+++ b/` headers; if not, mark as error with "patch malformed".
- **Empty diff** in Fix tab → render "No fix needed — finding may be a false positive" card.
- **Diff path differs from `finding.file`** → still render, with a warning chip "patch path differs from finding".
- **Token-cost guard**: refuse to generate if the scan started more than 24 hours ago, to avoid stale-demo replays running up costs. Soft guard; can be tuned.

## Testing Strategy

### Convex action tests (`convex/studio.test.ts`)
- Stub OpenAI (use existing pattern in `convex/agents.ts`; verify in plan phase).
- `generateExplain` happy path → row written with `status=done` and fields populated.
- OpenAI throws → `status=error`, error message stored.
- Malformed JSON output → raw text stored, `status=done`.
- `ensure` idempotency: calling twice while running schedules only one job.
- `ensure` retry on prior error resets the row and reschedules.
- `byFinding` returns latest row per kind.
- Code snippet fallback to `evidence` when clone is gone and raw fetch fails.

### Orchestrator integration tests (`convex/orchestrator.test.ts`)
- Scan with 5 kept findings → exactly 9 studio jobs scheduled.
- Scan with 0 kept findings → 0 studio jobs scheduled.
- Scan with 2 kept findings → 6 studio jobs scheduled.

### Per-angle prompt tests (`convex/prompts.test.ts`)
- Each of the 15 angles in `src/lib/angles.ts` has a `STUDIO_PROMPTS.prove` entry with the expected `proofKind`.
- Test fails if a new angle is added without a prove template (exhaustiveness check).

### Manual demo-readiness checklist (UI smoke)
- Run scan on a small repo; wait for done; top-3 findings show ✨ pill.
- Click top finding → drawer opens; Explain tab loaded instantly (eager); correct lines highlighted.
- Click Prove tab → content present (eager).
- Click Fix tab → diff renders correctly; fake button copies diff to clipboard.
- Click a non-top-3 finding → Explain auto-fires, ~5s spinner, then done.
- Click Prove tab on a non-top-3 finding → spinner → result.
- Force OpenAI error (mock 500) → error card with working retry.
- Reload page mid-generation → row state preserved; drawer reopens to current state.

No e2e framework is added — the repo currently has none, and the manual checklist is sufficient for the hackathon target.

UI components ship without unit tests (visual, manually verified). Convex action and prompt mapping tests follow TDD: written before implementation per `superpowers:test-driven-development`.

## Open Questions Deferred to Plan Phase

- Which syntax highlighter is already a transitive dep of installed packages (avoid adding a new dep if `shiki` or `prismjs` is already present).
- Existing OpenAI client mock pattern in `convex/agents.ts` — confirm shape before writing studio tests.
- Top-3 query: single batched query for all top-3 remediations vs three subscriptions in `FindingsTable` — chosen during plan based on existing query patterns.
