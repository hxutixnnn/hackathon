# Accuracy Moat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add content-addressed cache, embedding-cluster dedup pipeline, and juice-shop eval harness so the parallel-bug-bounty product hits 5/5 (Witchcraft) on Engineering Depth.

**Architecture:** Convex backend gains three orthogonal layers — `findingCache` (sha256-keyed agent output cache), `dedup` action (embedding+union-find clustering replacing the LLM reducer), and `eval` action (pure-code TP/FP/FN scoring against a hand-curated juice-shop truth table). React UI surfaces cache hit rate, dedup ratio, and live P/R/F1.

**Tech Stack:** Convex (DB, scheduler, real-time queries), OpenAI (`gpt-4o-mini` for agents/rerank, `text-embedding-3-small` for clustering), node `crypto`, Vitest for pure-function tests, React + Tailwind.

**Spec:** [docs/superpowers/specs/2026-05-09-accuracy-moat-design.md](../specs/2026-05-09-accuracy-moat-design.md)

---

## File Structure

**Create (Convex):**
- `convex/lib/hash.ts` — pure: `cacheKey()`, `chunkHash()`
- `convex/lib/cluster.ts` — pure: `cosine()`, `unionFind`, `lineRangesOverlap()`
- `convex/lib/path.ts` — pure: `normalizePath()`
- `convex/lib/eval.ts` — pure: `corpusFor()`, `scoreScan()`
- `convex/cache.ts` — Convex queries/mutations: `lookup`, `put`, plus stats helpers
- `convex/dedup.ts` — Convex action `run` (embed + cluster + rerank pipeline)
- `convex/eval.ts` — Convex action `score` + queries `benchmarkByScan`, `truthByCorpus`
- `convex/truth.ts` — Convex internal mutation `seed`
- `convex/truth_data.ts` — TS const `JUICE_SHOP_TRUTH`

**Create (frontend):**
- `src/components/StatsBar.tsx`
- `src/components/BenchmarkPanel.tsx`

**Create (tests):**
- `convex/lib/__tests__/hash.test.ts`
- `convex/lib/__tests__/cluster.test.ts`
- `convex/lib/__tests__/path.test.ts`
- `convex/lib/__tests__/eval.test.ts`

**Modify:**
- `convex/schema.ts` — add `findingCache`, `truth`, `benchmarks` tables; extend `scans`
- `convex/agents.ts` — cache lookup/put around OpenAI call; bump hit/miss
- `convex/scans.ts` — `bumpProgress` schedules `dedup.run` with `dedupStartedAt` race guard; new `bumpCacheHit`/`bumpCacheMiss` mutations
- `convex/prompts.ts` — add `PROMPT_VER` const
- `convex/reducer.ts` — DELETE (replaced by `dedup.ts`)
- `src/pages/Scan.tsx` — render `<StatsBar />` and `<BenchmarkPanel />`
- `src/components/FindingsTable.tsx` — green "matched" dot column
- `package.json` — add `vitest` devDep + `test` script
- `vitest.config.ts` — new config file

**Boundaries:**
- `convex/lib/*` files contain ONLY pure functions. No Convex imports. Unit-tested with Vitest.
- `convex/cache.ts`, `convex/dedup.ts`, `convex/eval.ts` are Convex layer; they call into `convex/lib/*` for logic.
- This split keeps the testable algorithm layer separate from the database layer.

---

## Task 1: Vitest setup

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Add Vitest devDep**

Run: `npm install --save-dev vitest`
Expected: package.json gets `vitest` under devDependencies; lockfile updated.

- [ ] **Step 2: Add test script to `package.json`**

Edit `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["convex/lib/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Verify Vitest runs**

Run: `npm test`
Expected: "No test files found, exiting with code 1" or similar — Vitest installed but nothing to run yet.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "test: add vitest for pure-function unit tests"
```

---

## Task 2: `cacheKey` + `chunkHash` (pure)

**Files:**
- Create: `convex/lib/hash.ts`
- Create: `convex/lib/__tests__/hash.test.ts`

- [ ] **Step 1: Write failing tests**

Create `convex/lib/__tests__/hash.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cacheKey, chunkHash } from "../hash";

describe("cacheKey", () => {
  const files = [
    { path: "b.ts", content: "two" },
    { path: "a.ts", content: "one" },
  ];

  it("is stable regardless of file order", () => {
    const k1 = cacheKey("xss", files, "gpt-4o-mini", "v1");
    const k2 = cacheKey("xss", [...files].reverse(), "gpt-4o-mini", "v1");
    expect(k1).toBe(k2);
  });

  it("changes when file content changes", () => {
    const k1 = cacheKey("xss", files, "gpt-4o-mini", "v1");
    const k2 = cacheKey(
      "xss",
      [{ path: "a.ts", content: "ONE" }, { path: "b.ts", content: "two" }],
      "gpt-4o-mini",
      "v1",
    );
    expect(k1).not.toBe(k2);
  });

  it("changes when angleId changes", () => {
    const k1 = cacheKey("xss", files, "gpt-4o-mini", "v1");
    const k2 = cacheKey("sqli", files, "gpt-4o-mini", "v1");
    expect(k1).not.toBe(k2);
  });

  it("changes when promptVer changes", () => {
    const k1 = cacheKey("xss", files, "gpt-4o-mini", "v1");
    const k2 = cacheKey("xss", files, "gpt-4o-mini", "v2");
    expect(k1).not.toBe(k2);
  });

  it("returns 64-char hex (sha256)", () => {
    const k = cacheKey("xss", files, "gpt-4o-mini", "v1");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles empty files array", () => {
    const k = cacheKey("xss", [], "gpt-4o-mini", "v1");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("chunkHash", () => {
  it("is stable regardless of file order", () => {
    const a = [
      { path: "x.ts", content: "x" },
      { path: "y.ts", content: "y" },
    ];
    expect(chunkHash(a)).toBe(chunkHash([...a].reverse()));
  });

  it("differs from cacheKey", () => {
    const files = [{ path: "a.ts", content: "one" }];
    expect(chunkHash(files)).not.toBe(
      cacheKey("xss", files, "gpt-4o-mini", "v1"),
    );
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `npm test`
Expected: import error / "Cannot find module '../hash'".

- [ ] **Step 3: Implement `convex/lib/hash.ts`**

```ts
import { createHash } from "node:crypto";

export type ChunkFile = { path: string; content: string };

export function chunkHash(files: ChunkFile[]): string {
  const h = createHash("sha256");
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of sorted) {
    h.update(f.path);
    h.update("\0");
    h.update(f.content);
    h.update("\0");
  }
  return h.digest("hex");
}

export function cacheKey(
  angleId: string,
  files: ChunkFile[],
  model: string,
  promptVer: string,
): string {
  const h = createHash("sha256");
  h.update(angleId);
  h.update("|");
  h.update(model);
  h.update("|");
  h.update(promptVer);
  h.update("|");
  h.update(chunkHash(files));
  return h.digest("hex");
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npm test`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/hash.ts convex/lib/__tests__/hash.test.ts
git commit -m "feat(cache): cacheKey + chunkHash pure utilities"
```

---

## Task 3: `cosine`, `unionFind`, `lineRangesOverlap` (pure)

**Files:**
- Create: `convex/lib/cluster.ts`
- Create: `convex/lib/__tests__/cluster.test.ts`

- [ ] **Step 1: Write failing tests**

Create `convex/lib/__tests__/cluster.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cosine, UnionFind, lineRangesOverlap } from "../cluster";

describe("cosine", () => {
  it("identical vectors → 1", () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it("orthogonal vectors → 0", () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it("negated vectors → -1", () => {
    expect(cosine([1, 2], [-1, -2])).toBeCloseTo(-1, 6);
  });

  it("zero vector → 0 (no NaN)", () => {
    expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe("UnionFind", () => {
  it("disjoint by default", () => {
    const uf = new UnionFind(3);
    expect(uf.find(0)).not.toBe(uf.find(1));
  });

  it("union merges", () => {
    const uf = new UnionFind(3);
    uf.union(0, 1);
    expect(uf.find(0)).toBe(uf.find(1));
    expect(uf.find(2)).not.toBe(uf.find(0));
  });

  it("union is transitive", () => {
    const uf = new UnionFind(4);
    uf.union(0, 1);
    uf.union(1, 2);
    expect(uf.find(0)).toBe(uf.find(2));
    expect(uf.find(3)).not.toBe(uf.find(0));
  });

  it("groups returns clusters as id arrays", () => {
    const uf = new UnionFind(5);
    uf.union(0, 1);
    uf.union(2, 3);
    const groups = uf.groups();
    expect(groups).toHaveLength(3);
    const sizes = groups.map((g) => g.length).sort();
    expect(sizes).toEqual([1, 2, 2]);
  });
});

describe("lineRangesOverlap", () => {
  it("touching ranges overlap (inclusive)", () => {
    expect(lineRangesOverlap(1, 5, 5, 10)).toBe(true);
  });

  it("contained range overlaps", () => {
    expect(lineRangesOverlap(1, 100, 50, 60)).toBe(true);
  });

  it("disjoint ranges do not overlap", () => {
    expect(lineRangesOverlap(1, 4, 6, 10)).toBe(false);
  });

  it("slack extends overlap window", () => {
    expect(lineRangesOverlap(1, 4, 8, 10, 5)).toBe(true);
    expect(lineRangesOverlap(1, 4, 8, 10, 2)).toBe(false);
  });

  it("identical single-line ranges overlap", () => {
    expect(lineRangesOverlap(7, 7, 7, 7)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `npm test`
Expected: import error.

- [ ] **Step 3: Implement `convex/lib/cluster.ts`**

```ts
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("vector length mismatch");
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export class UnionFind {
  private parent: number[];
  private rank: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) {
      this.parent[ra] = rb;
    } else if (this.rank[ra] > this.rank[rb]) {
      this.parent[rb] = ra;
    } else {
      this.parent[rb] = ra;
      this.rank[ra]++;
    }
  }
  groups(): number[][] {
    const map = new Map<number, number[]>();
    for (let i = 0; i < this.parent.length; i++) {
      const r = this.find(i);
      const list = map.get(r);
      if (list) list.push(i);
      else map.set(r, [i]);
    }
    return [...map.values()];
  }
}

export function lineRangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  slack = 0,
): boolean {
  return aStart - slack <= bEnd && bStart - slack <= aEnd;
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npm test`
Expected: 13+ passing.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/cluster.ts convex/lib/__tests__/cluster.test.ts
git commit -m "feat(dedup): cosine + union-find + line-overlap utilities"
```

---

## Task 4: `normalizePath` (pure)

**Files:**
- Create: `convex/lib/path.ts`
- Create: `convex/lib/__tests__/path.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { normalizePath } from "../path";

describe("normalizePath", () => {
  it("strips leading ./", () => {
    expect(normalizePath("./routes/login.ts")).toBe("routes/login.ts");
  });
  it("converts backslashes", () => {
    expect(normalizePath("routes\\login.ts")).toBe("routes/login.ts");
  });
  it("leaves clean paths alone", () => {
    expect(normalizePath("routes/login.ts")).toBe("routes/login.ts");
  });
  it("strips multiple leading ./", () => {
    expect(normalizePath("././x.ts")).toBe("x.ts");
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `npm test`

- [ ] **Step 3: Implement `convex/lib/path.ts`**

```ts
export function normalizePath(p: string): string {
  let s = p.replace(/\\/g, "/");
  while (s.startsWith("./")) s = s.slice(2);
  return s;
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npm test`

- [ ] **Step 5: Commit**

```bash
git add convex/lib/path.ts convex/lib/__tests__/path.test.ts
git commit -m "feat(eval): normalizePath utility"
```

---

## Task 5: `corpusFor` + `scoreScan` (pure)

**Files:**
- Create: `convex/lib/eval.ts`
- Create: `convex/lib/__tests__/eval.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { corpusFor, scoreScan } from "../eval";

describe("corpusFor", () => {
  it("matches juice-shop variants", () => {
    expect(corpusFor("https://github.com/juice-shop/juice-shop")).toBe("juice-shop");
    expect(corpusFor("git@github.com:juice-shop/juice-shop.git")).toBe("juice-shop");
    expect(corpusFor("https://github.com/JUICE-SHOP/juice-shop")).toBe("juice-shop");
  });
  it("returns null for unknown repos", () => {
    expect(corpusFor("https://github.com/torvalds/linux")).toBeNull();
  });
});

describe("scoreScan", () => {
  type Truth = { _id: string; file: string; lineStart: number; lineEnd: number };
  type Finding = { _id: string; file: string; lineStart: number; lineEnd: number };

  const truth: Truth[] = [
    { _id: "t1", file: "routes/login.ts", lineStart: 10, lineEnd: 20 },
    { _id: "t2", file: "routes/login.ts", lineStart: 50, lineEnd: 60 },
    { _id: "t3", file: "routes/cart.ts", lineStart: 5, lineEnd: 8 },
  ];

  it("perfect hit on every truth → recall=1", () => {
    const findings: Finding[] = [
      { _id: "f1", file: "routes/login.ts", lineStart: 12, lineEnd: 18 },
      { _id: "f2", file: "routes/login.ts", lineStart: 55, lineEnd: 56 },
      { _id: "f3", file: "routes/cart.ts", lineStart: 5, lineEnd: 5 },
    ];
    const r = scoreScan(truth, findings);
    expect(r.tp).toBe(3);
    expect(r.fn).toBe(0);
    expect(r.fp).toBe(0);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(1);
    expect(r.f1).toBe(1);
  });

  it("extra finding counts as FP", () => {
    const findings: Finding[] = [
      { _id: "f1", file: "routes/login.ts", lineStart: 12, lineEnd: 18 },
      { _id: "f2", file: "routes/other.ts", lineStart: 1, lineEnd: 2 },
    ];
    const r = scoreScan(truth, findings);
    expect(r.tp).toBe(1);
    expect(r.fp).toBe(1);
    expect(r.fn).toBe(2);
  });

  it("normalizes paths before compare", () => {
    const findings: Finding[] = [
      { _id: "f1", file: "./routes/login.ts", lineStart: 10, lineEnd: 11 },
    ];
    const r = scoreScan(truth, findings);
    expect(r.tp).toBe(1);
  });

  it("zero division safe — no truth, no findings → all zero", () => {
    const r = scoreScan([], []);
    expect(r.precision).toBe(0);
    expect(r.recall).toBe(0);
    expect(r.f1).toBe(0);
  });

  it("matchedFindingIds + matchedTruthIds populated", () => {
    const findings: Finding[] = [
      { _id: "f1", file: "routes/login.ts", lineStart: 12, lineEnd: 18 },
    ];
    const r = scoreScan(truth, findings);
    expect(r.matchedFindingIds).toEqual(["f1"]);
    expect(r.matchedTruthIds).toEqual(["t1"]);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `npm test`

- [ ] **Step 3: Implement `convex/lib/eval.ts`**

```ts
import { normalizePath } from "./path";
import { lineRangesOverlap } from "./cluster";

export function corpusFor(repoUrl: string): string | null {
  if (/juice-shop/i.test(repoUrl)) return "juice-shop";
  return null;
}

export type TruthRow = {
  _id: string;
  file: string;
  lineStart: number;
  lineEnd: number;
};

export type FindingRow = {
  _id: string;
  file: string;
  lineStart: number;
  lineEnd: number;
};

export type ScoreResult = {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  matchedTruthIds: string[];
  matchedFindingIds: string[];
};

export function scoreScan(
  truth: TruthRow[],
  findings: FindingRow[],
): ScoreResult {
  const matchedTruth = new Set<string>();
  const matchedFinding = new Set<string>();

  for (const t of truth) {
    const tFile = normalizePath(t.file);
    for (const f of findings) {
      const fFile = normalizePath(f.file);
      if (
        fFile === tFile &&
        lineRangesOverlap(f.lineStart, f.lineEnd, t.lineStart, t.lineEnd)
      ) {
        matchedTruth.add(t._id);
        matchedFinding.add(f._id);
        break;
      }
    }
  }

  const tp = matchedTruth.size;
  const fn = truth.length - tp;
  const fp = findings.length - matchedFinding.size;

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0
    ? 0
    : (2 * precision * recall) / (precision + recall);

  return {
    tp,
    fp,
    fn,
    precision,
    recall,
    f1,
    matchedTruthIds: [...matchedTruth],
    matchedFindingIds: [...matchedFinding],
  };
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npm test`

- [ ] **Step 5: Commit**

```bash
git add convex/lib/eval.ts convex/lib/__tests__/eval.test.ts
git commit -m "feat(eval): corpusFor + scoreScan pure scorer"
```

---

## Task 6: Schema additions

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Replace contents of `convex/schema.ts`**

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
    cacheHits: v.optional(v.number()),
    cacheMisses: v.optional(v.number()),
    dedupStartedAt: v.optional(v.number()),
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

  findingCache: defineTable({
    cacheKey: v.string(),
    angleId: v.string(),
    chunkHash: v.string(),
    model: v.string(),
    promptVer: v.string(),
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
    createdAt: v.number(),
  }).index("by_key", ["cacheKey"]),

  truth: defineTable({
    corpus: v.string(),
    file: v.string(),
    lineStart: v.number(),
    lineEnd: v.number(),
    cwe: v.optional(v.string()),
    title: v.string(),
    source: v.string(),
  }).index("by_corpus", ["corpus"]),

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
  }).index("by_scan", ["scanId"]),
});
```

- [ ] **Step 2: Verify Convex picks up new schema**

Run: `npx convex dev --once` (or check existing `convex dev` terminal)
Expected: schema deployed successfully, no validator errors.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(schema): findingCache, truth, benchmarks tables + scan stats fields"
```

---

## Task 7: `PROMPT_VER` const

**Files:**
- Modify: `convex/prompts.ts`

- [ ] **Step 1: Add export at top of `convex/prompts.ts`**

```ts
export const PROMPT_VER = "v1";
```

(Keep all other exports unchanged.)

- [ ] **Step 2: Commit**

```bash
git add convex/prompts.ts
git commit -m "feat(cache): PROMPT_VER const for cache invalidation"
```

---

## Task 8: `convex/cache.ts`

**Files:**
- Create: `convex/cache.ts`

- [ ] **Step 1: Implement cache lookup/put + scan-stat bumpers**

```ts
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const lookup = internalQuery({
  args: { cacheKey: v.string() },
  handler: async (ctx, { cacheKey }) => {
    const row = await ctx.db
      .query("findingCache")
      .withIndex("by_key", (q) => q.eq("cacheKey", cacheKey))
      .unique();
    return row?.findings ?? null;
  },
});

export const put = internalMutation({
  args: {
    cacheKey: v.string(),
    angleId: v.string(),
    chunkHash: v.string(),
    model: v.string(),
    promptVer: v.string(),
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
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("findingCache")
      .withIndex("by_key", (q) => q.eq("cacheKey", args.cacheKey))
      .unique();
    if (existing) return;
    await ctx.db.insert("findingCache", { ...args, createdAt: Date.now() });
  },
});

export const bumpHit = internalMutation({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return;
    await ctx.db.patch(scanId, { cacheHits: (scan.cacheHits ?? 0) + 1 });
  },
});

export const bumpMiss = internalMutation({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return;
    await ctx.db.patch(scanId, { cacheMisses: (scan.cacheMisses ?? 0) + 1 });
  },
});
```

- [ ] **Step 2: Verify Convex codegen picks up the new module**

Run: `npx convex dev --once`
Expected: `convex/_generated/api.d.ts` now includes `cache.lookup` / `cache.put` / `cache.bumpHit` / `cache.bumpMiss`. No errors.

- [ ] **Step 3: Commit**

```bash
git add convex/cache.ts
git commit -m "feat(cache): findingCache lookup/put + scan hit/miss counters"
```

---

## Task 9: Wire cache into agent

**Files:**
- Modify: `convex/agents.ts`

- [ ] **Step 1: Replace `convex/agents.ts` contents**

```ts
"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import OpenAI from "openai";
import { z } from "zod";
import { ANGLES, buildAgentPrompt, PROMPT_VER } from "./prompts";
import { cacheKey, chunkHash } from "./lib/hash";

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

const MODEL = "gpt-4o-mini";

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

    const key = cacheKey(angleId, files, MODEL, PROMPT_VER);

    const cached = await ctx.runQuery(internal.cache.lookup, { cacheKey: key });
    if (cached) {
      if (cached.length > 0) {
        await ctx.runMutation(internal.findings.insertMany, {
          scanId,
          angle: angleId,
          findings: cached,
        });
      }
      await ctx.runMutation(internal.cache.bumpHit, { scanId });
      await ctx.runMutation(internal.scans.bumpProgress, { scanId });
      return;
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let parsed: z.infer<typeof ResponseSchema> = { findings: [] };

    try {
      const res = await openai.chat.completions.create({
        model: MODEL,
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

    await ctx.runMutation(internal.cache.put, {
      cacheKey: key,
      angleId,
      chunkHash: chunkHash(files),
      model: MODEL,
      promptVer: PROMPT_VER,
      findings: parsed.findings,
    });
    await ctx.runMutation(internal.cache.bumpMiss, { scanId });
    await ctx.runMutation(internal.scans.bumpProgress, { scanId });
  },
});
```

- [ ] **Step 2: Verify codegen + typecheck**

Run: `npx convex dev --once`
Expected: no TS errors in `convex/agents.ts`.

- [ ] **Step 3: Commit**

```bash
git add convex/agents.ts
git commit -m "feat(cache): cache lookup/put around OpenAI agent call"
```

---

## Task 10: `convex/dedup.ts` Stage A (embed + cluster)

**Files:**
- Create: `convex/dedup.ts`

- [ ] **Step 1: Implement Stage A only (cluster, no rerank yet)**

```ts
"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import OpenAI from "openai";
import { cosine, UnionFind, lineRangesOverlap } from "./lib/cluster";
import { corpusFor } from "./lib/eval";

const COSINE_THRESHOLD = 0.85;
const LINE_SLACK = 5;
const EMBED_MODEL = "text-embedding-3-small";
const MAX_INPUTS = 2048;

export const run = internalAction({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    try {
      const scan = await ctx.runQuery(internal.scans_internal.getInternal, {
        scanId,
      });
      if (!scan) return;

      const findings = await ctx.runQuery(
        internal.scans_internal.findingsForReducer,
        { scanId },
      );

      if (findings.length === 0 || findings.length > MAX_INPUTS) {
        await markAllKept(ctx, findings);
        await runEvalAndFinish(ctx, scanId, scan.repoUrl);
        return;
      }

      const inputs = findings.map(
        (f) =>
          `${f.angle}|${f.file}:${f.lineStart}-${f.lineEnd}|${f.title}\n${f.description}`,
      );

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      let embeddings: number[][];
      try {
        const res = await openai.embeddings.create({
          model: EMBED_MODEL,
          input: inputs,
        });
        embeddings = res.data.map((d) => d.embedding);
      } catch (err) {
        console.error("embed failed, keeping all", err);
        await markAllKept(ctx, findings);
        await runEvalAndFinish(ctx, scanId, scan.repoUrl);
        return;
      }

      const uf = new UnionFind(findings.length);
      for (let i = 0; i < findings.length; i++) {
        for (let j = i + 1; j < findings.length; j++) {
          if (findings[i].file !== findings[j].file) continue;
          if (
            !lineRangesOverlap(
              findings[i].lineStart,
              findings[i].lineEnd,
              findings[j].lineStart,
              findings[j].lineEnd,
              LINE_SLACK,
            )
          )
            continue;
          if (cosine(embeddings[i], embeddings[j]) >= COSINE_THRESHOLD) {
            uf.union(i, j);
          }
        }
      }

      const clusters = uf.groups();
      const reps: { id: string; severity: number }[] = [];
      const dropped: string[] = [];

      for (const cluster of clusters) {
        const sorted = [...cluster].sort((a, b) => {
          const sa = findings[a].severity;
          const sb = findings[b].severity;
          if (sa !== sb) return sb - sa;
          return findings[a].title.length - findings[b].title.length;
        });
        const repIdx = sorted[0];
        reps.push({
          id: findings[repIdx]._id,
          severity: findings[repIdx].severity,
        });
        for (let k = 1; k < sorted.length; k++) {
          dropped.push(findings[sorted[k]]._id);
        }
      }

      await ctx.runMutation(internal.dedup.applyClusters, {
        keptIds: reps.map((r) => r.id),
        droppedIds: dropped,
      });

      await runEvalAndFinish(ctx, scanId, scan.repoUrl);
    } catch (err: any) {
      await ctx.runMutation(internal.scans.setStatus, {
        scanId,
        status: "error",
        error: err?.message ?? String(err),
      });
    }
  },
});

async function markAllKept(
  ctx: any,
  findings: { _id: string }[],
): Promise<void> {
  await ctx.runMutation(internal.dedup.applyClusters, {
    keptIds: findings.map((f) => f._id),
    droppedIds: [],
  });
}

async function runEvalAndFinish(
  ctx: any,
  scanId: any,
  repoUrl: string,
): Promise<void> {
  if (corpusFor(repoUrl)) {
    await ctx.runAction(internal.eval.score, { scanId });
  }
  await ctx.runMutation(internal.scans.setStatus, { scanId, status: "done" });
}
```

- [ ] **Step 2: Add `applyClusters` mutation alongside (in same file? No, mutations must not be in `"use node"` files). Create as separate file `convex/dedup_mutations.ts`**

```ts
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const applyClusters = internalMutation({
  args: {
    keptIds: v.array(v.string()),
    droppedIds: v.array(v.string()),
  },
  handler: async (ctx, { keptIds, droppedIds }) => {
    for (const id of keptIds) {
      try {
        await ctx.db.patch(id as any, { reducerKept: true });
      } catch {}
    }
    for (const id of droppedIds) {
      try {
        await ctx.db.patch(id as any, { reducerKept: false });
      } catch {}
    }
  },
});
```

But the mutation needs to be referenced as `internal.dedup.applyClusters` to match the action's call. Move the mutation into `convex/dedup_mutations.ts` and reference it as `internal.dedup_mutations.applyClusters`. **Update `convex/dedup.ts` Step 1 to use that path.** Edit the two `runMutation(internal.dedup.applyClusters, ...)` calls in dedup.ts to `runMutation(internal.dedup_mutations.applyClusters, ...)` before committing.

- [ ] **Step 3: Verify codegen + typecheck**

Run: `npx convex dev --once`
Expected: no TS errors. Both `internal.dedup.run` and `internal.dedup_mutations.applyClusters` exist in generated api.

- [ ] **Step 4: Commit**

```bash
git add convex/dedup.ts convex/dedup_mutations.ts
git commit -m "feat(dedup): embedding + union-find clustering pipeline (Stage A)"
```

---

## Task 11: Race-free `bumpProgress` → schedule `dedup.run`

**Files:**
- Modify: `convex/scans.ts`

- [ ] **Step 1: Replace `bumpProgress` mutation in `convex/scans.ts`**

Replace the existing `bumpProgress` export with:

```ts
export const bumpProgress = internalMutation({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return;
    const completed = scan.completedAgents + 1;
    await ctx.db.patch(scanId, { completedAgents: completed });
    if (
      completed >= scan.totalAgents &&
      scan.totalAgents > 0 &&
      !scan.dedupStartedAt
    ) {
      await ctx.db.patch(scanId, {
        status: "reducing",
        dedupStartedAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.dedup.run, { scanId });
    }
  },
});
```

- [ ] **Step 2: Verify codegen + typecheck**

Run: `npx convex dev --once`
Expected: no errors. Old `internal.reducer.run` reference is now gone.

- [ ] **Step 3: Commit**

```bash
git add convex/scans.ts
git commit -m "feat(dedup): race-free bumpProgress schedules dedup.run via dedupStartedAt guard"
```

---

## Task 12: Delete obsolete reducer

**Files:**
- Delete: `convex/reducer.ts`

- [ ] **Step 1: Delete file**

Run: `rm convex/reducer.ts`

- [ ] **Step 2: Verify nothing references it**

Run: `grep -rn "internal.reducer" convex/ src/ 2>/dev/null || echo "clean"`
Expected: `clean`

- [ ] **Step 3: Verify Convex still compiles**

Run: `npx convex dev --once`

- [ ] **Step 4: Commit**

```bash
git add -A convex/reducer.ts
git commit -m "refactor: remove obsolete reducer.ts (replaced by dedup pipeline)"
```

---

## Task 13: Truth seed data

**Files:**
- Create: `convex/truth_data.ts`
- Create: `convex/truth.ts`

- [ ] **Step 1: Create `convex/truth_data.ts`**

```ts
// Pinned to juice-shop tag v17.x. Sources: https://pwning.owasp-juice.shop/
// File paths are repo-root-relative POSIX (matching repo.ts:55 output).
// Line numbers verified against juice-shop/v17.0.0 manually.

export type TruthRow = {
  file: string;
  lineStart: number;
  lineEnd: number;
  cwe?: string;
  title: string;
  source: string;
};

export const JUICE_SHOP_TRUTH: TruthRow[] = [
  {
    file: "routes/login.ts",
    lineStart: 35,
    lineEnd: 60,
    cwe: "CWE-89",
    title: "SQL Injection in login query",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/injection.html#log-in-with-the-administrators-user-account",
  },
  {
    file: "routes/search.ts",
    lineStart: 1,
    lineEnd: 40,
    cwe: "CWE-89",
    title: "SQL Injection via search query",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/injection.html",
  },
  {
    file: "routes/userProfile.ts",
    lineStart: 1,
    lineEnd: 100,
    cwe: "CWE-94",
    title: "SSTI in user profile page",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/injection.html#perform-a-server-side-request-forgery",
  },
  {
    file: "routes/fileUpload.ts",
    lineStart: 1,
    lineEnd: 80,
    cwe: "CWE-434",
    title: "Unrestricted file upload",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/improper-input-validation.html",
  },
  {
    file: "routes/fileServer.ts",
    lineStart: 1,
    lineEnd: 60,
    cwe: "CWE-22",
    title: "Path traversal in file server",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/broken-access-control.html",
  },
  {
    file: "routes/redirect.ts",
    lineStart: 1,
    lineEnd: 40,
    cwe: "CWE-601",
    title: "Open redirect via allowlist bypass",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/unvalidated-redirects.html",
  },
  {
    file: "routes/basket.ts",
    lineStart: 1,
    lineEnd: 60,
    cwe: "CWE-639",
    title: "IDOR in basket access",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/broken-access-control.html",
  },
  {
    file: "routes/changePassword.ts",
    lineStart: 1,
    lineEnd: 50,
    cwe: "CWE-352",
    title: "CSRF on password change endpoint",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/broken-authentication.html",
  },
  {
    file: "routes/coupon.ts",
    lineStart: 1,
    lineEnd: 40,
    cwe: "CWE-1023",
    title: "Weak coupon code validation",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/improper-input-validation.html",
  },
  {
    file: "routes/order.ts",
    lineStart: 1,
    lineEnd: 80,
    cwe: "CWE-639",
    title: "IDOR in order details",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/broken-access-control.html",
  },
  {
    file: "routes/dataExport.ts",
    lineStart: 1,
    lineEnd: 80,
    cwe: "CWE-200",
    title: "Sensitive data export",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/sensitive-data-exposure.html",
  },
  {
    file: "lib/insecurity.ts",
    lineStart: 1,
    lineEnd: 100,
    cwe: "CWE-327",
    title: "Weak crypto / hardcoded secret",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/cryptographic-issues.html",
  },
  {
    file: "routes/feedback.ts",
    lineStart: 1,
    lineEnd: 60,
    cwe: "CWE-79",
    title: "Stored XSS via feedback comment",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/xss.html",
  },
  {
    file: "routes/track.ts",
    lineStart: 1,
    lineEnd: 40,
    cwe: "CWE-79",
    title: "Reflected XSS in track-result",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/xss.html",
  },
  {
    file: "routes/saveLoginIp.ts",
    lineStart: 1,
    lineEnd: 40,
    cwe: "CWE-345",
    title: "Trust of unverified header",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/broken-authentication.html",
  },
  {
    file: "routes/2fa.ts",
    lineStart: 1,
    lineEnd: 80,
    cwe: "CWE-287",
    title: "2FA bypass via parameter tampering",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/broken-authentication.html",
  },
  {
    file: "routes/payment.ts",
    lineStart: 1,
    lineEnd: 80,
    cwe: "CWE-840",
    title: "Negative amount in payment",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/improper-input-validation.html",
  },
  {
    file: "routes/recycles.ts",
    lineStart: 1,
    lineEnd: 60,
    cwe: "CWE-639",
    title: "IDOR in recycle item access",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/broken-access-control.html",
  },
  {
    file: "routes/profileImageUrlUpload.ts",
    lineStart: 1,
    lineEnd: 60,
    cwe: "CWE-918",
    title: "SSRF via profile image URL",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/server-side-request-forgery.html",
  },
  {
    file: "frontend/src/app/login/login.component.ts",
    lineStart: 1,
    lineEnd: 100,
    cwe: "CWE-798",
    title: "Hardcoded credentials in client",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/sensitive-data-exposure.html",
  },
];
```

**Note to engineer:** Verify these line ranges against the actual juice-shop v17.0.0 source before relying on the F1 number. Line ranges are intentionally generous (file-wide) where exact lines were not verifiable to avoid undercounting TPs in the demo. Tighten ranges when you have time.

- [ ] **Step 2: Create `convex/truth.ts`**

```ts
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { JUICE_SHOP_TRUTH } from "./truth_data";

export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("truth")
      .withIndex("by_corpus", (q) => q.eq("corpus", "juice-shop"))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);
    for (const t of JUICE_SHOP_TRUTH) {
      await ctx.db.insert("truth", { corpus: "juice-shop", ...t });
    }
  },
});

export const byCorpus = query({
  args: { corpus: v.string() },
  handler: async (ctx, { corpus }) => {
    return await ctx.db
      .query("truth")
      .withIndex("by_corpus", (q) => q.eq("corpus", corpus))
      .collect();
  },
});
```

- [ ] **Step 3: Run seed once**

Run: `npx convex run truth:seed` (uses public-runnable form; if marked internal, run `npx convex run --component truth seed` or via dashboard)

If seed is internal-only, change `internalMutation` to `mutation` temporarily for the run, or invoke via Convex dashboard "Run Function" UI. Document chosen path inline before committing.

Expected: 20 rows in `truth` table (visible in Convex dashboard).

- [ ] **Step 4: Verify rows in dashboard**

Open Convex dashboard → `truth` table → confirm 20 rows with `corpus = "juice-shop"`.

- [ ] **Step 5: Commit**

```bash
git add convex/truth.ts convex/truth_data.ts
git commit -m "feat(eval): juice-shop truth seed (~20 rows from owasp-juice.shop)"
```

---

## Task 14: `convex/eval.ts` action + queries

**Files:**
- Create: `convex/eval.ts`

- [ ] **Step 1: Implement scoring action + queries**

```ts
import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { scoreScan, corpusFor } from "./lib/eval";

export const score = internalAction({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.runQuery(internal.scans_internal.getInternal, {
      scanId,
    });
    if (!scan) return;
    const corpus = corpusFor(scan.repoUrl);
    if (!corpus) return;

    const truth = await ctx.runQuery(internal.eval.truthByCorpusInternal, {
      corpus,
    });
    const findings = await ctx.runQuery(internal.eval.keptFindings, {
      scanId,
    });

    const result = scoreScan(
      truth.map((t: any) => ({
        _id: t._id,
        file: t.file,
        lineStart: t.lineStart,
        lineEnd: t.lineEnd,
      })),
      findings.map((f: any) => ({
        _id: f._id,
        file: f.file,
        lineStart: f.lineStart,
        lineEnd: f.lineEnd,
      })),
    );

    await ctx.runMutation(internal.eval.writeBenchmark, {
      scanId,
      corpus,
      ...result,
    });
  },
});

export const writeBenchmark = internalMutation({
  args: {
    scanId: v.id("scans"),
    corpus: v.string(),
    tp: v.number(),
    fp: v.number(),
    fn: v.number(),
    precision: v.number(),
    recall: v.number(),
    f1: v.number(),
    matchedTruthIds: v.array(v.string()),
    matchedFindingIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("benchmarks", {
      scanId: args.scanId,
      corpus: args.corpus,
      tp: args.tp,
      fp: args.fp,
      fn: args.fn,
      precision: args.precision,
      recall: args.recall,
      f1: args.f1,
      matchedTruthIds: args.matchedTruthIds as any,
      matchedFindingIds: args.matchedFindingIds as any,
    });
  },
});

export const truthByCorpusInternal = internalAction({
  args: { corpus: v.string() },
  handler: async (ctx, { corpus }) => {
    return await ctx.runQuery(internal.truth.byCorpusInternal, { corpus });
  },
});

export const keptFindings = internalAction({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    return await ctx.runQuery(internal.scans_internal.keptFindings, {
      scanId,
    });
  },
});

export const benchmarkByScan = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    return await ctx.db
      .query("benchmarks")
      .withIndex("by_scan", (q) => q.eq("scanId", scanId))
      .first();
  },
});
```

- [ ] **Step 2: Add helper queries to `convex/scans_internal.ts` and `convex/truth.ts`**

In `convex/scans_internal.ts` add:

```ts
export const keptFindings = internalQuery({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    return await ctx.db
      .query("findings")
      .withIndex("by_scan", (q) => q.eq("scanId", scanId))
      .filter((q) => q.neq(q.field("reducerKept"), false))
      .collect();
  },
});
```

(Add `internalQuery` import at top if not present.)

In `convex/truth.ts` add:

```ts
export const byCorpusInternal = internalQuery({
  args: { corpus: v.string() },
  handler: async (ctx, { corpus }) => {
    return await ctx.db
      .query("truth")
      .withIndex("by_corpus", (q) => q.eq("corpus", corpus))
      .collect();
  },
});
```

(Add `internalQuery` import.)

- [ ] **Step 3: Simplify `eval.ts` — remove unnecessary action wrappers**

Re-edit `convex/eval.ts` to call the internal queries directly from the `score` action (remove `truthByCorpusInternal` and `keptFindings` action wrappers, inline `ctx.runQuery(internal.truth.byCorpusInternal, ...)` and `ctx.runQuery(internal.scans_internal.keptFindings, ...)`):

```ts
import { v } from "convex/values";
import { internalAction, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { scoreScan, corpusFor } from "./lib/eval";

export const score = internalAction({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.runQuery(internal.scans_internal.getInternal, {
      scanId,
    });
    if (!scan) return;
    const corpus = corpusFor(scan.repoUrl);
    if (!corpus) return;

    const truth = await ctx.runQuery(internal.truth.byCorpusInternal, {
      corpus,
    });
    const findings = await ctx.runQuery(
      internal.scans_internal.keptFindings,
      { scanId },
    );

    const result = scoreScan(
      truth.map((t) => ({
        _id: t._id,
        file: t.file,
        lineStart: t.lineStart,
        lineEnd: t.lineEnd,
      })),
      findings.map((f) => ({
        _id: f._id,
        file: f.file,
        lineStart: f.lineStart,
        lineEnd: f.lineEnd,
      })),
    );

    await ctx.runMutation(internal.eval.writeBenchmark, {
      scanId,
      corpus,
      ...result,
    });
  },
});

export const writeBenchmark = internalMutation({
  args: {
    scanId: v.id("scans"),
    corpus: v.string(),
    tp: v.number(),
    fp: v.number(),
    fn: v.number(),
    precision: v.number(),
    recall: v.number(),
    f1: v.number(),
    matchedTruthIds: v.array(v.string()),
    matchedFindingIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("benchmarks", {
      scanId: args.scanId,
      corpus: args.corpus,
      tp: args.tp,
      fp: args.fp,
      fn: args.fn,
      precision: args.precision,
      recall: args.recall,
      f1: args.f1,
      matchedTruthIds: args.matchedTruthIds as any,
      matchedFindingIds: args.matchedFindingIds as any,
    });
  },
});

export const benchmarkByScan = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    return await ctx.db
      .query("benchmarks")
      .withIndex("by_scan", (q) => q.eq("scanId", scanId))
      .first();
  },
});
```

- [ ] **Step 4: Verify codegen + typecheck**

Run: `npx convex dev --once`
Expected: no errors. `internal.eval.score`, `internal.eval.writeBenchmark`, `eval.benchmarkByScan` all generated.

- [ ] **Step 5: Commit**

```bash
git add convex/eval.ts convex/scans_internal.ts convex/truth.ts
git commit -m "feat(eval): pure-code scoreScan action + benchmarkByScan query"
```

---

## Task 15: `<StatsBar />` component

**Files:**
- Create: `src/components/StatsBar.tsx`
- Modify: `src/pages/Scan.tsx`

- [ ] **Step 1: Create `src/components/StatsBar.tsx`**

```tsx
type Props = {
  totalAgents: number;
  completedAgents: number;
  cacheHits: number;
  cacheMisses: number;
  rawFindings: number;
  keptFindings: number;
};

export function StatsBar({
  totalAgents,
  completedAgents,
  cacheHits,
  cacheMisses,
  rawFindings,
  keptFindings,
}: Props) {
  const total = cacheHits + cacheMisses;
  const hitPct = total > 0 ? Math.round((100 * cacheHits) / total) : 0;
  return (
    <div className="grid grid-cols-3 gap-4 rounded border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
      <div>
        <div className="text-xs uppercase text-zinc-500">Agents</div>
        <div className="font-mono text-base text-zinc-100">
          {completedAgents}/{totalAgents}
        </div>
      </div>
      <div>
        <div className="text-xs uppercase text-zinc-500">Cache</div>
        <div className="font-mono text-base text-zinc-100">
          {cacheHits}/{total} hit ({hitPct}%)
        </div>
      </div>
      <div>
        <div className="text-xs uppercase text-zinc-500">Findings</div>
        <div className="font-mono text-base text-zinc-100">
          {rawFindings} → {keptFindings} dedup
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `src/pages/Scan.tsx`**

Add at top of `Scan.tsx` imports:

```tsx
import { StatsBar } from "../components/StatsBar";
```

In the JSX (above existing `<AngleGrid />`), insert:

```tsx
{scan && (
  <StatsBar
    totalAgents={scan.totalAgents}
    completedAgents={scan.completedAgents}
    cacheHits={scan.cacheHits ?? 0}
    cacheMisses={scan.cacheMisses ?? 0}
    rawFindings={findings?.length ?? 0}
    keptFindings={
      findings?.filter((f) => f.reducerKept !== false).length ?? 0
    }
  />
)}
```

(Names of the existing scan/findings query results in `Scan.tsx` may differ; use the existing variable names already in scope.)

- [ ] **Step 3: Run dev server and verify renders**

Run: `npm run dev` (already running per CLAUDE.md guidance — check existing terminal)
Open localhost URL → start a scan → confirm StatsBar shows above AngleGrid with live counts.

- [ ] **Step 4: Commit**

```bash
git add src/components/StatsBar.tsx src/pages/Scan.tsx
git commit -m "feat(ui): StatsBar showing agents/cache/dedup live"
```

---

## Task 16: `<BenchmarkPanel />` + matched dot

**Files:**
- Create: `src/components/BenchmarkPanel.tsx`
- Modify: `src/components/FindingsTable.tsx`
- Modify: `src/pages/Scan.tsx`

- [ ] **Step 1: Create `src/components/BenchmarkPanel.tsx`**

```tsx
type Benchmark = {
  corpus: string;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
};

export function BenchmarkPanel({ benchmark }: { benchmark: Benchmark | null | undefined }) {
  if (!benchmark) return null;
  const fmt = (n: number) => n.toFixed(2);
  return (
    <div className="rounded border border-emerald-800 bg-emerald-950/30 px-4 py-3 text-sm">
      <div className="mb-2 text-xs uppercase text-emerald-400">
        Benchmark vs {benchmark.corpus}
      </div>
      <div className="grid grid-cols-4 gap-4 font-mono">
        <Metric label="Precision" value={fmt(benchmark.precision)} />
        <Metric label="Recall" value={fmt(benchmark.recall)} />
        <Metric label="F1" value={fmt(benchmark.f1)} accent />
        <Metric
          label="Hits"
          value={`${benchmark.tp}/${benchmark.tp + benchmark.fn}`}
        />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={accent ? "text-lg text-emerald-300" : "text-base text-zinc-100"}>
        {value}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `src/components/FindingsTable.tsx` to accept `matchedFindingIds`**

Current file has 57 lines. Add a `matchedFindingIds?: string[]` prop, render a small green dot in the leftmost column when `finding._id` is in the set.

```tsx
type Props = {
  findings: any[];
  matchedFindingIds?: string[];
};

export function FindingsTable({ findings, matchedFindingIds }: Props) {
  const matched = new Set(matchedFindingIds ?? []);
  // ... existing render, but in the row's first cell:
  // {matched.has(f._id) && <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-400" title="matches ground truth" />}
  // ...
}
```

(Engineer: read the existing FindingsTable.tsx and integrate the dot into the existing row layout — do not rewrite from scratch. Only the matched-dot logic and the new prop are new.)

- [ ] **Step 3: Add benchmark query + wire into `Scan.tsx`**

Add at top of `Scan.tsx`:

```tsx
import { BenchmarkPanel } from "../components/BenchmarkPanel";
```

Add a query call (uses existing Convex `useQuery` import already in the file):

```tsx
const benchmark = useQuery(api.eval.benchmarkByScan, scanId ? { scanId } : "skip");
```

In the JSX, below `<StatsBar />` and above `<AngleGrid />`:

```tsx
<BenchmarkPanel benchmark={benchmark ?? null} />
```

Update the existing `<FindingsTable />` invocation to pass `matchedFindingIds`:

```tsx
<FindingsTable
  findings={findings ?? []}
  matchedFindingIds={benchmark?.matchedFindingIds as string[] | undefined}
/>
```

- [ ] **Step 4: Verify in browser**

Run: `npm run dev` (or use existing terminal)
Scan `https://github.com/juice-shop/juice-shop` → after dedup completes, BenchmarkPanel renders with P/R/F1, FindingsTable rows with truth matches show green dots.

- [ ] **Step 5: Commit**

```bash
git add src/components/BenchmarkPanel.tsx src/components/FindingsTable.tsx src/pages/Scan.tsx
git commit -m "feat(ui): BenchmarkPanel + matched-truth dot in FindingsTable"
```

---

## Task 17: Stage B rerank (LLM rerank top-30)

**Files:**
- Modify: `convex/dedup.ts`
- Modify: `convex/dedup_mutations.ts`

- [ ] **Step 1: Add `applyRerank` mutation to `convex/dedup_mutations.ts`**

Append:

```ts
export const applyRerank = internalMutation({
  args: {
    ranks: v.array(
      v.object({
        id: v.string(),
        rank: v.number(),
        severity: v.number(),
      }),
    ),
  },
  handler: async (ctx, { ranks }) => {
    for (const r of ranks) {
      try {
        await ctx.db.patch(r.id as any, {
          reducerRank: r.rank,
          reducerSeverity: r.severity,
        });
      } catch {}
    }
  },
});
```

- [ ] **Step 2: Add Stage B call inside `convex/dedup.ts` after clustering**

After the existing `applyClusters` call and before `runEvalAndFinish`, insert:

```ts
const top = reps
  .sort((a, b) => b.severity - a.severity)
  .slice(0, 30);

if (top.length > 0) {
  try {
    const repFindings = top.map((r) => findings.find((f) => f._id === r.id)!);
    const prompt = buildRerankPrompt(repFindings);
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1500,
    });
    const text = res.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text);
    const ranks = (parsed.ranked ?? [])
      .filter(
        (r: any) =>
          typeof r?.id === "string" &&
          typeof r?.rank === "number" &&
          typeof r?.severity === "number",
      )
      .map((r: any) => ({
        id: r.id,
        rank: r.rank,
        severity: Math.max(1, Math.min(10, Math.round(r.severity))),
      }));
    if (ranks.length > 0) {
      await ctx.runMutation(internal.dedup_mutations.applyRerank, { ranks });
    }
  } catch (err) {
    console.error("rerank failed, keeping raw severity ranks", err);
  }
}
```

Add `buildRerankPrompt` helper at module scope (same file):

```ts
function buildRerankPrompt(
  reps: { _id: string; angle: string; file: string; lineStart: number; lineEnd: number; title: string; description: string; severity: number }[],
): string {
  const items = reps
    .map(
      (r) =>
        `id=${r._id} angle=${r.angle} ${r.file}:${r.lineStart}-${r.lineEnd} sev=${r.severity}\n  ${r.title}`,
    )
    .join("\n");
  return `You are reranking ${reps.length} security findings by exploitability and impact.
Return JSON: {"ranked": [{"id": "...", "rank": <1-based>, "severity": <1-10>}]}.
Lower rank = more critical. Severity may be adjusted up or down by 1-2 from the input.

Findings:
${items}`;
}
```

- [ ] **Step 3: Verify codegen + typecheck**

Run: `npx convex dev --once`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add convex/dedup.ts convex/dedup_mutations.ts
git commit -m "feat(dedup): Stage B LLM rerank of top-30 representatives"
```

---

## Task 18: Demo verification

**Files:** none (manual run + screenshots)

- [ ] **Step 1: Cold scan juice-shop**

In browser:
1. Paste `https://github.com/juice-shop/juice-shop` into the scan input.
2. Click Scan.
3. Confirm StatsBar starts ticking. cache 0/N. findings counter rising.

Expected behavior:
- Status: cloning → scanning → reducing → done
- StatsBar: cache hits = 0 first run (cold); cache misses = total agents
- BenchmarkPanel renders after status=done with non-zero TP and F1 ≥ 0.3 (sanity floor; F1 < 0.3 means truth or angle prompts need tuning)

- [ ] **Step 2: Warm scan (cache validation)**

Scan the same `https://github.com/juice-shop/juice-shop` URL again immediately.

Expected:
- cache hits ≥ 90% of total agents
- Total time < 30 seconds
- Same benchmark numbers as cold run (determinism check — write down both, compare)

- [ ] **Step 3: Negative case (eval-skip)**

Scan a non-juice-shop repo (e.g. `https://github.com/sindresorhus/leven`).

Expected:
- BenchmarkPanel does NOT render (returns null on no benchmark row)
- StatsBar still renders with cache stats
- Scan completes normally

- [ ] **Step 4: Screenshot for demo**

Capture screenshots of:
- Stats bar mid-scan
- BenchmarkPanel post-scan
- FindingsTable with matched green dots

Save to `docs/scan-witchcraft-1.png`, `docs/scan-witchcraft-2.png`, etc.

- [ ] **Step 5: Final commit**

```bash
git add docs/
git commit -m "docs: demo screenshots for accuracy-moat features"
```

---

## Self-Review Notes

**Spec coverage:**

- [x] Cache (`findingCache`) — Task 6 schema + Task 8 cache.ts + Task 9 agent wiring
- [x] Embedding cluster dedup — Task 10 (Stage A) + Task 17 (Stage B)
- [x] Eval harness — Task 13 truth + Task 14 eval.ts
- [x] Race-free `bumpProgress` — Task 11
- [x] Path normalization — Task 4
- [x] StatsBar UI — Task 15
- [x] BenchmarkPanel UI + matched dot — Task 16
- [x] Demo verification — Task 18

**Cuts noted in spec, mapped:**
- Hidden FN truth panel → not in plan (matches spec cut #1)
- Stage B rerank → Task 17, isolated, can be skipped if time runs out (matches spec cut #2)
- AngleGrid changes → not modified (matches spec cut #4)

**Type consistency check:** `cacheKey`, `chunkHash`, `cosine`, `UnionFind`, `lineRangesOverlap`, `normalizePath`, `corpusFor`, `scoreScan` defined once in `convex/lib/*` and imported consistently. Convex internal API names: `internal.cache.lookup/put/bumpHit/bumpMiss`, `internal.dedup.run`, `internal.dedup_mutations.applyClusters/applyRerank`, `internal.eval.score/writeBenchmark`, `internal.truth.byCorpusInternal`, `internal.scans_internal.keptFindings/getInternal`. All match across tasks.

**Known gaps engineer must verify at runtime:**
- juice-shop truth file paths and line ranges in `truth_data.ts` — line ranges intentionally generous, tighten when verified
- `convex/scans_internal.ts` `internalQuery` import — engineer must add if not present (Task 14 Step 2)
- `convex/eval.ts` `truthByCorpusInternal` action wrapper removed in Step 3 — final code in Step 3 is canonical, Step 1 is intermediate
- `internal.scans_internal.findingsForReducer` query referenced in `dedup.ts` — confirmed exists in current `scans_internal.ts` (used by old reducer); keep it.
