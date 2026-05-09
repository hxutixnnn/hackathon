# Accuracy Moat — Design

**Date:** 2026-05-09
**Project:** Parallel Bug Bounty
**Goal:** Push Engineering Depth track to 5/5 (Witchcraft) by building features a "codex CLI + prompt engineer" cannot trivially replicate.

## Problem Framing

Veteran-engineer judges may attack with: *"I can replace your product with a codex agent and a prompt engineer — why should I use this?"*

Single-agent CLI cannot offer:

- **Determinism** — same input → same output
- **Numeric accuracy claims** — no ground-truth loop
- **Whole-program reasoning beyond context limits**
- **Reproducible cost** — caching, budget caps
- **Observable per-stage operability** — cache hit rate, dedup ratio, eval drift

This spec adds three features that together force the attacker to also build a benchmarked, cached, deterministic dedup pipeline — i.e. to do the same work.

## In Scope

1. Content-addressed agent-output cache (`findingCache` table)
2. Embedding-based finding dedup pipeline replacing the current single-LLM reducer
3. Eval harness scoring scans against a hand-curated juice-shop ground truth (precision, recall, F1)
4. UI surfacing for cache hit rate, dedup ratio, and benchmark numbers

## Out of Scope

- Multi-corpus eval (juice-shop only)
- CWE category matching (line-overlap only)
- Cache eviction / TTL
- AST-aware chunking
- Cross-file taint analysis
- SARIF / GitHub PR comment export

## Architecture

```
Browser ── WS ── Convex
                  │
                  ├─ scans (existing, +cacheHits, +cacheMisses)
                  ├─ findings (existing, +reducerKept, +reducerRank, +reducerSeverity already present)
                  ├─ findingCache (NEW)  ─── cacheKey → findings[]
                  ├─ truth         (NEW)  ─── juice-shop hand-curated rows
                  └─ benchmarks    (NEW)  ─── per-scan P/R/F1

orchestrator ──> Workpool ──> agent
                                ├─ cacheKey = sha256(angle|model|promptVer|chunkHash)
                                ├─ lookup findingCache
                                │    hit  → insertMany(cached) → bumpProgress → return
                                │    miss → OpenAI → parse → insertMany → cache.put → bumpProgress
                                │
                            (last agent done)
                                │
                                ▼
                       dedup.run (NEW, replaces reducer.run)
                          A. embed all findings (text-embedding-3-small, batch ≤2048)
                          B. union-find cluster, cosine ≥ 0.85, gated by file+line overlap
                          C. mark representatives (max severity); patch others reducerKept=false
                          D. LLM rerank top-30 representatives → reducerRank, reducerSeverity
                                │
                                ▼
                       eval.score (NEW)
                          if corpusFor(scan.repoUrl) != null:
                            compute TP/FP/FN vs truth → insert benchmarks row
                                │
                                ▼
                       scans.setStatus("done")
```

## Components

### 1. Cache (`convex/cache.ts`, schema additions)

**Schema:**

```ts
findingCache: defineTable({
  cacheKey: v.string(),
  angleId: v.string(),
  chunkHash: v.string(),
  model: v.string(),
  promptVer: v.string(),
  findings: v.array(v.object({
    file: v.string(),
    lineStart: v.number(),
    lineEnd: v.number(),
    severity: v.number(),
    title: v.string(),
    description: v.string(),
    evidence: v.string(),
  })),
  createdAt: v.number(),
}).index("by_key", ["cacheKey"])

scans: defineTable({
  // existing fields kept as-is
  cacheHits: v.optional(v.number()),
  cacheMisses: v.optional(v.number()),
  dedupStartedAt: v.optional(v.number()),  // race guard for bumpProgress
})
```

**Key construction:**

```ts
function cacheKey(angleId, files, model, promptVer) {
  const h = crypto.createHash("sha256");
  h.update(angleId); h.update("|");
  h.update(model);   h.update("|");
  h.update(promptVer); h.update("|");
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    h.update(f.path); h.update("\0");
    h.update(f.content); h.update("\0");
  }
  return h.digest("hex");
}
```

**API:**

- `internal.cache.lookup({ cacheKey }) → findings[] | null`
- `internal.cache.put({ cacheKey, angleId, chunkHash, model, promptVer, findings })`
- `mutation.scans.bumpCacheHit({ scanId })` / `bumpCacheMiss({ scanId })`

**`promptVer`** lives as a `const PROMPT_VER = "v1"` in `convex/prompts.ts`. Bump invalidates cache cleanly. No TTL.

**Agent flow** (`convex/agents.ts`):

1. Compute `cacheKey`.
2. `runQuery(internal.cache.lookup, { cacheKey })`.
3. Hit → `findings.insertMany`, `scans.bumpCacheHit`, `scans.bumpProgress`, return.
4. Miss → OpenAI call as today → parse → `findings.insertMany` → `cache.put` → `scans.bumpCacheMiss` → `scans.bumpProgress`.

**`bumpProgress` mutation change** (`convex/scans.ts`): replace scheduler call from `internal.reducer.run` to `internal.dedup.run`, gated by `dedupStartedAt` set atomically inside the same mutation:

```ts
if (completed >= scan.totalAgents && scan.totalAgents > 0 && !scan.dedupStartedAt) {
  await ctx.db.patch(scanId, { status: "reducing", dedupStartedAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.dedup.run, { scanId });
}
```

The `!scan.dedupStartedAt` check + atomic patch prevents double-scheduling under race.

### 2. Dedup pipeline (`convex/dedup.ts`, replaces `convex/reducer.ts`)

**Stage A — embed + cluster** (`"use node"`):

1. Load all findings for `scanId` (default `reducerKept` undefined treated as true).
2. Embed text per finding: `${angle}|${file}:${lineStart}-${lineEnd}|${title}\n${description}`.
3. One batch call: `openai.embeddings.create({ model: "text-embedding-3-small", input: [...] })`. Cap at 2048 inputs (Stage A degrades to no-op above; not expected).
4. Pairwise cosine on embeddings; union-find merge if:
   - `cosine(i, j) >= 0.85`, **and**
   - `findings[i].file === findings[j].file`, **and**
   - line ranges overlap with slack ≥ 5.
5. Per cluster: pick representative = max severity, tiebreak shortest title length. Patch others `reducerKept = false`. Patch representative `reducerKept = true`.

**Stage B — LLM rerank within scan:**

6. Take top 30 representatives by raw severity.
7. One LLM call (gpt-4o-mini, JSON mode). Input = title + 1-line description + file:line. Output = ranked list with final severity. Small prompt, no ID hallucination risk.
8. Patch `reducerRank`, `reducerSeverity` on representatives.

**Failure modes:**

- Embedding API failure → fall back to "keep all, no dedup". Mark `reducerKept = true` for all. Scan completes.
- Stage B failure → keep Stage A clusters; assign `reducerRank` by raw severity descending.

**Why this beats current reducer:**

- Determinism: cosine + union-find is pure math. Current reducer is one nondeterministic LLM call.
- Scale: embed batch + O(n²) cosine handles 1000+ findings. Current reducer crams all IDs into one prompt → hallucinates past ~50.
- Cost: 1 batch embed (~$0.00002/1k tok) + 1 small rerank << current N×M tokens.

### 3. Eval harness (`convex/eval.ts`, `convex/truth.ts`, `convex/truth_data.ts`)

**Schema:**

```ts
truth: defineTable({
  corpus: v.string(),
  file: v.string(),
  lineStart: v.number(),
  lineEnd: v.number(),
  cwe: v.optional(v.string()),
  title: v.string(),
  source: v.string(),
}).index("by_corpus", ["corpus"])

benchmarks: defineTable({
  scanId: v.id("scans"),
  corpus: v.string(),
  tp: v.number(),
  fp: v.number(),
  fn: v.number(),
  precision: v.number(),
  recall: v.number(),
  f1: v.number(),
  matchedTruthIds: v.array(v.id("truth")),
  matchedFindingIds: v.array(v.id("findings")),
}).index("by_scan", ["scanId"])
```

**Truth source:** `convex/truth_data.ts` — checked-in TS const, ~20 entries from `https://pwning.owasp-juice.shop`. Pinned to juice-shop tag `v17.x`.

**Seed:** `internal.truth.seed` mutation called once at deploy via `convex/_generated/api` cron or one-shot script. Idempotent: clears `truth` rows for corpus before re-inserting.

**Corpus detection:**

```ts
function corpusFor(repoUrl: string): string | null {
  if (/juice-shop/i.test(repoUrl)) return "juice-shop";
  return null;
}
```

**Scorer (pure code, no LLM):**

```
load truth where corpus = X
load findings where scanId = S and reducerKept = true
matchedFindings = set
matchedTruth = set
for T in truth:
  hits = [f for f in findings if f.file == T.file
          and f.lineStart <= T.lineEnd
          and f.lineEnd >= T.lineStart]
  if hits: tp++; matchedTruth.add(T._id); matchedFindings.add(hits[0]._id)
  else:    fn++
fp = len(findings) - len(matchedFindings)
precision = tp / (tp+fp) if (tp+fp) else 0
recall    = tp / (tp+fn) if (tp+fn) else 0
f1        = 2*p*r/(p+r) if (p+r) else 0
insert benchmarks row
```

**Match rule:** `f.file === T.file` (exact string after normalization) AND line ranges overlap by ≥1 line.

**Path normalization:**

- Tarball extracts to `tmp/<owner>-<repo>-<sha>/...`. `repo.ts:55` calls `path.relative(base, full)` where `base` is the extracted root, yielding repo-root-relative POSIX paths (e.g. `routes/login.ts`).
- Truth file paths in `truth_data.ts` MUST use the same form (no leading `/`, no `./`, forward slashes).
- Scorer compares with `===`. Add a `normalize(p) { return p.replace(/^\.\//, "").replace(/\\/g, "/") }` helper applied to both sides before compare.

**Trigger:** called from `dedup.run` end if `corpusFor(scan.repoUrl) != null`. Otherwise skipped silently and scan still completes.

### 4. UI (`src/pages/Scan.tsx` additions)

**`<StatsBar />`** above existing `<AngleGrid />`:

```
agents 60/60   cache 38/60 hit (63%)   findings 184 → 47 dedup
```

Pulls from `scans.get` (existing fields + new `cacheHits`/`cacheMisses`) and `findings.byScan` (count where `reducerKept !== false`).

**`<BenchmarkPanel />`** below stats bar, conditional on `benchmarks.byScan` returning a row:

```
─ Benchmark vs juice-shop ───────────────────
Precision 0.71  Recall 0.65  F1 0.68
14/20 truth rows hit
```

**Findings table** (`src/components/FindingsTable.tsx`): add green dot column for findings whose `_id ∈ benchmark.matchedFindingIds`.

**Hidden truth panel** (toggle "Show ground truth"): list missed truth rows (FN) with link to `truth.source`.

**New queries:**

- `query.eval.benchmarkByScan({ scanId })`
- `query.eval.truthByCorpus({ corpus })`

(Cache stats reused from `scans.get`.)

## Data Flow

1. User pastes juice-shop URL → `scans.start`.
2. Orchestrator chunks files, enqueues N agent tasks.
3. Each agent: cacheKey → lookup → hit returns instantly, miss calls OpenAI then caches. Either way `findings.insertMany` + `bumpProgress`.
4. Last agent triggers `dedup.run` (replaces current `reducer.run`).
5. Dedup: embed batch → union-find clusters → mark representatives → LLM rerank top-30.
6. If juice-shop corpus matched: `eval.score` runs after dedup, writes `benchmarks` row.
7. `scans.setStatus("done")`.
8. UI live-updates each step via Convex queries.

## Error Handling

| Stage | Failure | Behavior |
|---|---|---|
| Cache lookup | Convex query error | Treat as miss, log, continue |
| Cache put | Convex mutation error | Log, continue (next agent re-pays) |
| Agent OpenAI call | 429 / 5xx | Existing Workpool retry; on final fail, no findings inserted, progress still bumped |
| Embed batch | API error | Skip dedup; mark all `reducerKept=true`; scan completes |
| Stage B rerank | API error or parse fail | Keep Stage A clusters; assign `reducerRank` by raw severity |
| Eval scorer | Truth empty / corpus mismatch | Skip silently; no benchmark row |
| `bumpProgress` race | Two agents see `completed == total - 1` | Atomic `dedupStartedAt` guard set inside same mutation transaction (see `bumpProgress` change above) |

## Testing

**Unit (Vitest, no Convex):**

- `cacheKey()` — same files reordered → identical key; different content → different key; empty array → stable.
- `cosine()` — orthogonal=0, identical=1, negated=-1.
- `unionFind` — transitive merge correctness.
- `lineRangesOverlap()` — touching, contained, disjoint, single-line.
- `corpusFor()` — juice-shop forks, `.git` suffix, mixed casing.
- `scoreScan()` — fixture: 3 truth rows × 5 findings → expected `tp/fp/fn`, `f1` exact.

**Integration (Convex test harness):**

- Cache miss → put → second call returns identical findings.
- Dedup: 4 findings same file overlapping lines → 1 representative kept, 3 marked `reducerKept=false`.
- Eval skipped when `corpusFor` returns null.
- Eval fires when juice-shop URL passed; benchmark row created.

**E2E (manual demo):**

- Cold scan juice-shop tag v17.x → benchmark row written, F1 ≥ 0.5 sanity floor.
- Re-scan same URL → cache hit% ≥ 90%, finish < 30s.

## Risks

| Risk | Mitigation |
|---|---|
| Truth rows wrong line numbers (juice-shop drift) | Pin to juice-shop tag `v17.x`; document tag in `truth_data.ts` header |
| Cosine threshold 0.85 too aggressive | Calibrate on 50 manual finding pairs before commit; expose const for tuning |
| F1 < 0.3 on demo | Tune angle prompts; if still poor, drop benchmark from demo, pitch infra only |
| Embedding latency adds 5-10s | Acceptable; runs after agents complete, parallel to UI render |
| `bumpProgress` race fires `dedup.run` twice | Atomic `dedupStartedAt` guard inside `bumpProgress` mutation transaction (only schedule if unset; set in same patch) |

## Cut Scope (drop in this order if time crunched)

1. Hidden truth panel (FN list)
2. Stage B LLM rerank
3. `promptVer` versioning
4. AngleGrid integration changes (keep current as-is)

**Hard floor (must ship):**

- Cache + hit/miss stats on `scans` row
- Embedding cluster dedup (Stage A only)
- Truth seed + scorer + benchmarks row
- StatsBar + BenchmarkPanel rendering live numbers

## Pitch Against Codex+Prompt Attack

| Judge claim | Response |
|---|---|
| "I can replace this with a codex agent + prompt engineer" | Reproduce our F1 = 0.68 on juice-shop. Without an eval harness, you cannot. To match, you must build the same harness, cache, embed pipeline, and dedup. You are doing the work we did. |
| "Just run codex twice and union the output" | Nondeterministic. Same input gives different findings. Our cache + cluster gives stable output across runs — required for CI integration and regression detection. |
| "Why dedup, the LLM can do it" | Current single-LLM reducer caps at ~50 findings before token-limit collapse. Embedding cluster scales to thousands and runs in < 2s. |
| "Why cache" | Codex CLI re-pays full token cost each invocation. Our `findingCache` is content-addressed; rescans cost zero LLM tokens for unchanged code. |
