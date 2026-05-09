# UI Visualization Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static angle grid with a coordinated motion arc (Home idle constellation → launch morph → live scan constellation → done-state reveal sequence), making the parallel-orchestration story visceral.

**Architecture:** Single SVG `Constellation` component with `idle` and `live` modes is reused across Home and Scan. Framer Motion drives the cross-route morph (`layoutId`) and table-row stagger. A new convex query `angleSummaries` collapses 15 per-angle aggregates into one read. A done-state `useEffect` chains a 1.5s reveal sequence using `setTimeout`.

**Tech Stack:** React 19, Vite, Tailwind 3, Framer Motion (new), Convex 1.38, react-router-dom 7, TypeScript.

**Important context for the implementer:**
- `severity` in this codebase is a **number 1–10**, not a string. Color tier mapping uses thresholds (≥9 critical, ≥7 high, ≥5 medium, ≥3 low, else idle). Match `src/components/SeverityBadge.tsx` thresholds.
- No test framework is installed (this is a hackathon project). Verification is done by running `npm run dev` and clicking through the flow in a browser. Do not install vitest/jest.
- Convex dev server must already be running in another terminal (`npx convex dev`). The frontend talks to it via `VITE_CONVEX_URL`.
- The 15 attack angles and their order are defined in `src/components/AngleGrid.tsx` (`ANGLE_LABELS`). Preserve the same order in the constellation so cluster positions are stable.
- After every task, smoke-test in browser before committing. If a task adds a component without wiring it in, smoke-test means "page still loads, no console errors".

---

## File Structure

**New files:**
- `src/components/Constellation.tsx` — SVG visualization, idle + live modes, ~180 LOC.
- `src/components/TopFindingCard.tsx` — done-state hero card, ~50 LOC.
- `src/components/SeveritySparkline.tsx` — 4-bar severity distribution, ~50 LOC.
- `src/lib/severity.ts` — shared `severityTier(n: number): "critical"|"high"|"medium"|"low"|"idle"` and `severityColor(tier)` helpers, ~30 LOC.
- `src/lib/angles.ts` — `ANGLES` constant moved here (id + label) so both `Constellation` and old code can import without circular deps.

**Modified files:**
- `src/main.tsx` — wrap `<Routes>` in `<AnimatePresence mode="wait">` keyed on `location.pathname`. Move route declaration into a child component so `useLocation()` is available.
- `src/pages/Home.tsx` — add idle constellation as background; URL input fades on submit; center node uses shared `layoutId`.
- `src/pages/Scan.tsx` — replace `AngleGrid` with `Constellation` in live mode; add `TopFindingCard` and `SeveritySparkline` rendered when `status === "done"`; add reveal sequence `useEffect`.
- `src/components/FindingsTable.tsx` — wrap row mapping in `<AnimatePresence>` and use `motion.div` per row with stagger; pass `revealStage` prop for done-state badge color-pulse wave.
- `src/components/SeverityBadge.tsx` — refactor to use `severityTier`/`severityColor`; add optional `pulse` boolean prop.
- `tailwind.config.js` — extend `theme.colors.severity` with tier tokens.
- `convex/findings.ts` — add `angleSummaries` query; remove `countsByAngle` (only consumer is `AngleGrid`, which is being deleted).
- `package.json` — add `framer-motion` dependency.

**Deleted files:**
- `src/components/AngleGrid.tsx` — superseded by `Constellation`.

---

## Task 1: Setup — install framer-motion and define severity tokens

**Files:**
- Modify: `package.json` (via npm)
- Modify: `tailwind.config.js`
- Create: `src/lib/severity.ts`

- [ ] **Step 1: Install framer-motion**

```bash
npm install framer-motion
```

Expected: `framer-motion` appears in `package.json` dependencies. No errors.

- [ ] **Step 2: Add severity color tokens to tailwind config**

Replace the contents of `tailwind.config.js` with:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        severity: {
          critical: "#ef4444",
          high: "#f59e0b",
          medium: "#eab308",
          low: "#10b981",
          idle: "#475569",
        },
      },
      keyframes: {
        twinkle: {
          "0%, 100%": { opacity: "0.3" },
          "50%": { opacity: "0.65" },
        },
        spinSlow: {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        nodePulse: {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.2)" },
        },
      },
      animation: {
        twinkle: "twinkle 4s ease-in-out infinite",
        spinSlow: "spinSlow 60s linear infinite",
        nodePulse: "nodePulse 800ms ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 3: Create severity helpers**

Create `src/lib/severity.ts`:

```ts
export type SeverityTier = "critical" | "high" | "medium" | "low" | "idle";

export function severityTier(severity: number | null | undefined): SeverityTier {
  if (severity == null) return "idle";
  const s = Math.round(severity);
  if (s >= 9) return "critical";
  if (s >= 7) return "high";
  if (s >= 5) return "medium";
  if (s >= 3) return "low";
  return "idle";
}

export const SEVERITY_HEX: Record<SeverityTier, string> = {
  critical: "#ef4444",
  high: "#f59e0b",
  medium: "#eab308",
  low: "#10b981",
  idle: "#475569",
};

// Tailwind class fragments (use as template literals only — Tailwind cannot scan dynamic class names)
export const SEVERITY_BG_CLASS: Record<SeverityTier, string> = {
  critical: "bg-severity-critical",
  high: "bg-severity-high",
  medium: "bg-severity-medium",
  low: "bg-severity-low",
  idle: "bg-severity-idle",
};
```

- [ ] **Step 4: Verify build still works**

```bash
npm run build
```

Expected: Build succeeds with no errors. (TS strictness will catch any obvious issues now.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tailwind.config.js src/lib/severity.ts
git commit -m "setup: framer-motion, severity color tokens, severityTier helper"
```

---

## Task 2: Move ANGLES constant into shared module

**Files:**
- Create: `src/lib/angles.ts`
- Modify: `src/components/AngleGrid.tsx`

This step does not change behavior; it just moves the constant so the new `Constellation` component can import it without depending on `AngleGrid`. We delete `AngleGrid` in a later task; until then, both files reference the same source.

- [ ] **Step 1: Create the shared module**

Create `src/lib/angles.ts`:

```ts
export type Angle = { id: string; label: string };

export const ANGLES: Angle[] = [
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
```

- [ ] **Step 2: Refactor AngleGrid to import from the shared module**

In `src/components/AngleGrid.tsx`, replace the local `ANGLE_LABELS` array with an import. The new top of the file:

```tsx
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ANGLES } from "../lib/angles";

export default function AngleGrid({ scanId }: { scanId: Id<"scans"> }) {
  const counts = useQuery(api.findings.countsByAngle, { scanId }) ?? {};
  return (
    <div className="grid grid-cols-5 md:grid-cols-8 lg:grid-cols-15 gap-2">
      {ANGLES.map((a) => {
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

- [ ] **Step 3: Smoke test**

```bash
npm run dev
```

Open the printed URL, navigate to a scan page, confirm the angle grid still renders identically. Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add src/lib/angles.ts src/components/AngleGrid.tsx
git commit -m "refactor: extract ANGLES to src/lib/angles.ts"
```

---

## Task 3: Refactor SeverityBadge to use severity tokens, add pulse prop

**Files:**
- Modify: `src/components/SeverityBadge.tsx`

- [ ] **Step 1: Rewrite SeverityBadge**

Replace `src/components/SeverityBadge.tsx` with:

```tsx
import { severityTier } from "../lib/severity";

export default function SeverityBadge({
  severity,
  pulse = false,
}: {
  severity: number;
  pulse?: boolean;
}) {
  const s = Math.max(1, Math.min(10, Math.round(severity)));
  const tier = severityTier(s);
  const bgClass = {
    critical: "bg-severity-critical text-white",
    high: "bg-severity-high text-white",
    medium: "bg-severity-medium text-slate-900",
    low: "bg-severity-low text-slate-900",
    idle: "bg-severity-idle text-slate-100",
  }[tier];
  const pulseClass = pulse ? "ring-2 ring-white/40" : "";
  return (
    <span
      className={`inline-flex items-center justify-center w-8 h-8 rounded-md font-bold text-sm transition-all duration-300 ${bgClass} ${pulseClass}`}
    >
      {s}
    </span>
  );
}
```

The `pulse` prop adds a temporary ring used by the done-state reveal wave (Task 12).

- [ ] **Step 2: Smoke test**

```bash
npm run dev
```

Open a scan with findings. Verify badges still show colored numbers. Severity 9–10 should be red (`#ef4444`), 7–8 amber, 5–6 yellow, 3–4 green, 1–2 slate. Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add src/components/SeverityBadge.tsx
git commit -m "ui: SeverityBadge uses severity tokens + adds pulse prop"
```

---

## Task 4: Add `angleSummaries` convex query

**Files:**
- Modify: `convex/findings.ts`

Per `convex/_generated/ai/guidelines.md` rules, add the query without removing the existing `countsByAngle` (we delete that in Task 9, after `AngleGrid` is removed).

- [ ] **Step 1: Read convex guidelines**

```bash
cat convex/_generated/ai/guidelines.md | head -80
```

Confirm: query syntax, validators, return types. Use `v.array(v.object({...}))` for the return value if a return validator is required by project convention; otherwise leave untyped (match existing `countsByAngle` style).

- [ ] **Step 2: Add the query**

Append to `convex/findings.ts` (after `countsByAngle`, before `insertMany`):

```ts
export const angleSummaries = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_scan", (q) => q.eq("scanId", scanId))
      .collect();
    const byAngle: Record<string, { count: number; maxSeverity: number; latestAt: number }> = {};
    for (const r of rows) {
      const cur = byAngle[r.angle] ?? { count: 0, maxSeverity: 0, latestAt: 0 };
      cur.count += 1;
      cur.maxSeverity = Math.max(cur.maxSeverity, r.severity);
      cur.latestAt = Math.max(cur.latestAt, r._creationTime);
      byAngle[r.angle] = cur;
    }
    return Object.entries(byAngle).map(([angle, v]) => ({
      angle,
      count: v.count,
      maxSeverity: v.maxSeverity,
      latestAt: v.latestAt,
    }));
  },
});
```

- [ ] **Step 3: Verify convex regenerates types**

If `npx convex dev` is running in another terminal, it auto-regenerates `convex/_generated/api.d.ts`. Otherwise:

```bash
npx convex codegen
```

Expected: `api.findings.angleSummaries` is now typed.

- [ ] **Step 4: Smoke test**

```bash
npm run dev
```

Open browser dev console, run a scan. Then in the console:

```js
// In Convex dashboard or by adding a temporary log to Scan.tsx; verify the shape
```

Simpler: add a temporary `const x = useQuery(api.findings.angleSummaries, { scanId });` and a `console.log(x)` to `Scan.tsx`, run a scan, confirm an array of `{angle, count, maxSeverity, latestAt}` objects appears once findings start streaming. Then revert the temp log. Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add convex/findings.ts
git commit -m "convex: add findings.angleSummaries query"
```

---

## Task 5: Build static `Constellation` component (idle mode)

**Files:**
- Create: `src/components/Constellation.tsx`

Build the SVG component with both modes typed but only the idle render path implemented in this task. Live mode is added in Task 6.

- [ ] **Step 1: Create the component**

Create `src/components/Constellation.tsx`:

```tsx
import { ANGLES } from "../lib/angles";
import { SEVERITY_HEX, severityTier, type SeverityTier } from "../lib/severity";

export type AngleSummary = {
  angle: string;
  count: number;
  maxSeverity: number;
  latestAt: number;
};

type IdleProps = {
  mode: "idle";
  centerLabel?: string;
};

type LiveProps = {
  mode: "live";
  summaries: AngleSummary[];
  centerLabel: string; // e.g. "42 / 150"
  activeAngle: string | null;
};

export type ConstellationProps = (IdleProps | LiveProps) & {
  className?: string;
};

const VIEW = 600; // square viewBox
const CENTER = VIEW / 2;
const ORBIT = 220;

// Precompute orbit positions for the 15 angles, evenly distributed.
const ANGLE_POSITIONS = ANGLES.map((a, i) => {
  const theta = (i / ANGLES.length) * 2 * Math.PI - Math.PI / 2;
  return {
    id: a.id,
    label: a.label,
    x: CENTER + Math.cos(theta) * ORBIT,
    y: CENTER + Math.sin(theta) * ORBIT,
  };
});

export default function Constellation(props: ConstellationProps) {
  const { className = "" } = props;
  const isLive = props.mode === "live";

  return (
    <svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className={`w-full h-full ${className}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <radialGradient id="centerHalo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* idle: rotate the entire group; live: no rotation */}
      <g
        style={{
          transformOrigin: `${CENTER}px ${CENTER}px`,
          animation: isLive ? undefined : "spinSlow 60s linear infinite",
        }}
      >
        {/* lines from center to each node */}
        {ANGLE_POSITIONS.map((p) => (
          <line
            key={`l-${p.id}`}
            x1={CENTER}
            y1={CENTER}
            x2={p.x}
            y2={p.y}
            stroke="#1e293b"
            strokeWidth={1}
            opacity={0.5}
          />
        ))}

        {/* outer nodes */}
        {ANGLE_POSITIONS.map((p) => (
          <g key={`n-${p.id}`}>
            <circle
              cx={p.x}
              cy={p.y}
              r={6}
              fill={SEVERITY_HEX.idle}
              style={{
                animation: isLive ? undefined : "twinkle 4s ease-in-out infinite",
                animationDelay: `${(p.x + p.y) % 4}s`,
              }}
            />
          </g>
        ))}
      </g>

      {/* center node — outside rotating group so labels stay upright */}
      <circle cx={CENTER} cy={CENTER} r={70} fill="url(#centerHalo)" />
      <circle cx={CENTER} cy={CENTER} r={isLive ? 18 : 10} fill="#10b981" />
      {props.centerLabel && (
        <text
          x={CENTER}
          y={CENTER + 4}
          textAnchor="middle"
          fontSize={isLive ? 14 : 8}
          fontFamily="ui-monospace, monospace"
          fill="#0b1220"
          fontWeight={600}
        >
          {props.centerLabel}
        </text>
      )}
    </svg>
  );
}

// Helper exported for Task 6 — derive node radius and color from a summary.
export function nodeStyleFor(
  summary: AngleSummary | undefined,
): { radius: number; tier: SeverityTier; fill: string } {
  if (!summary || summary.count === 0) {
    return { radius: 8, tier: "idle", fill: SEVERITY_HEX.idle };
  }
  const radius = 8 + Math.min(summary.count * 1.2, 16);
  const tier = severityTier(summary.maxSeverity);
  return { radius, tier, fill: SEVERITY_HEX[tier] };
}
```

- [ ] **Step 2: Smoke test by mounting on Scan page temporarily**

In `src/pages/Scan.tsx`, add (just for the smoke test) above the existing `AngleGrid` block:

```tsx
import Constellation from "../components/Constellation";
// ...
<div className="bg-slate-950 border border-slate-900 rounded-lg" style={{ height: 480 }}>
  <Constellation mode="idle" centerLabel="repo" />
</div>
```

```bash
npm run dev
```

Open scan page. Verify: 15 nodes visible around a green center, lines connect them, group rotates slowly, nodes twinkle independently. Then **remove the temp mount** from `Scan.tsx` before committing.

- [ ] **Step 3: Commit**

```bash
git add src/components/Constellation.tsx
git commit -m "ui: Constellation component (idle mode)"
```

---

## Task 6: Add live mode to Constellation

**Files:**
- Modify: `src/components/Constellation.tsx`

Wire the `live` mode path so node radius, color, and pulse react to `summaries` and `activeAngle`.

- [ ] **Step 1: Replace the outer-nodes block**

In `Constellation.tsx`, replace the `{/* outer nodes */}` block with:

```tsx
{/* outer nodes */}
{ANGLE_POSITIONS.map((p) => {
  const summary = isLive
    ? (props as LiveProps).summaries.find((s) => s.angle === p.id)
    : undefined;
  const { radius, fill } = nodeStyleFor(summary);
  const isActive = isLive && (props as LiveProps).activeAngle === p.id;
  return (
    <g
      key={`n-${p.id}`}
      style={{
        transformOrigin: `${p.x}px ${p.y}px`,
        animation: isActive
          ? "nodePulse 800ms ease-in-out infinite"
          : isLive
          ? undefined
          : "twinkle 4s ease-in-out infinite",
        animationDelay: isLive ? undefined : `${(p.x + p.y) % 4}s`,
      }}
    >
      <circle
        cx={p.x}
        cy={p.y}
        r={isLive ? radius : 6}
        fill={isLive ? fill : SEVERITY_HEX.idle}
        style={{ transition: "r 400ms ease, fill 400ms ease" }}
      />
      {isLive && (
        <text
          x={p.x}
          y={p.y + radius + 14}
          textAnchor="middle"
          fontSize={10}
          fontFamily="ui-monospace, monospace"
          fill="#64748b"
        >
          {p.label}
        </text>
      )}
    </g>
  );
})}
```

Also adjust line opacity for live mode — replace the `<line>` block:

```tsx
{ANGLE_POSITIONS.map((p) => {
  const summary = isLive
    ? (props as LiveProps).summaries.find((s) => s.angle === p.id)
    : undefined;
  const opacity = isLive ? 0.2 + Math.min((summary?.count ?? 0) * 0.06, 0.6) : 0.5;
  return (
    <line
      key={`l-${p.id}`}
      x1={CENTER}
      y1={CENTER}
      x2={p.x}
      y2={p.y}
      stroke="#1e293b"
      strokeWidth={1}
      opacity={opacity}
      style={{ transition: "opacity 400ms ease" }}
    />
  );
})}
```

Note that `<animate>` SVG attribute changes don't transition smoothly via CSS for `r`. Browsers vary. For Chrome/Firefox/Safari the `transition: r` works as written. If the animation looks abrupt during testing, drop it — visual fallback is acceptable.

- [ ] **Step 2: Smoke-test live mode by temporarily wiring on Scan page**

In `src/pages/Scan.tsx` (temporarily; cleanup happens in Task 9):

```tsx
import Constellation from "../components/Constellation";
import type { AngleSummary } from "../components/Constellation";
// ...
const summaries = (useQuery(api.findings.angleSummaries, { scanId }) ?? []) as AngleSummary[];
const latestAngle = summaries.length > 0
  ? summaries.reduce((acc, s) => (s.latestAt > acc.latestAt ? s : acc)).angle
  : null;
// ...
<div className="bg-slate-950 border border-slate-900 rounded-lg p-4" style={{ height: 520 }}>
  <Constellation
    mode="live"
    summaries={summaries}
    centerLabel={`${scan.completedAgents} / ${scan.totalAgents}`}
    activeAngle={latestAngle}
  />
</div>
```

```bash
npm run dev
```

Run a scan. Verify nodes change radius and color as findings stream, and the most-recent angle pulses. Stop dev server but **leave the temp mount in place** — Task 9 cleans it up.

- [ ] **Step 3: Commit**

```bash
git add src/components/Constellation.tsx
git commit -m "ui: Constellation live mode (radius/color/pulse from summaries)"
```

---

## Task 7: Add `useActiveAngle` hook with debounce

**Files:**
- Create: `src/lib/useActiveAngle.ts`

Extract the active-angle derivation into a hook that debounces by 200ms (per spec risk-mitigation note) and clears after 1.5s of inactivity.

- [ ] **Step 1: Create the hook**

Create `src/lib/useActiveAngle.ts`:

```ts
import { useEffect, useRef, useState } from "react";
import type { AngleSummary } from "../components/Constellation";

const DEBOUNCE_MS = 200;
const ACTIVE_WINDOW_MS = 1500;

export function useActiveAngle(summaries: AngleSummary[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (summaries.length === 0) return;
    const latest = summaries.reduce((acc, s) => (s.latestAt > acc.latestAt ? s : acc));
    const ageMs = Date.now() - latest.latestAt;
    if (ageMs > ACTIVE_WINDOW_MS) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setActive(latest.angle);
      if (clearRef.current) clearTimeout(clearRef.current);
      clearRef.current = setTimeout(() => setActive(null), ACTIVE_WINDOW_MS - ageMs);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (clearRef.current) clearTimeout(clearRef.current);
    };
  }, [summaries]);

  return active;
}
```

- [ ] **Step 2: Wire it into Scan page**

In `src/pages/Scan.tsx`, replace the inline `latestAngle` computation from Task 6 with:

```tsx
import { useActiveAngle } from "../lib/useActiveAngle";
// ...
const activeAngle = useActiveAngle(summaries);
// pass `activeAngle={activeAngle}` to <Constellation>
```

- [ ] **Step 3: Smoke test**

```bash
npm run dev
```

Run a scan; verify pulse activates ~200ms after a finding arrives and stops ~1.5s after the last one. Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add src/lib/useActiveAngle.ts src/pages/Scan.tsx
git commit -m "ui: useActiveAngle hook (200ms debounce, 1.5s window)"
```

---

## Task 8: Home page — constellation background + input fade

> **Note on layoutId morph (deviation from spec):** The spec describes a Framer `layoutId` morph that animates the center node from Home to Scan. In practice, because the Home constellation is rendered as a large background layer (opacity 0.4) and the Scan constellation is in a bordered panel of different size, position, and opacity, a true layoutId morph would look messy. We use the spec's documented fallback: a 200ms crossfade between routes via `<AnimatePresence mode="wait">` and per-page `<motion.div>` enter/exit. This is good enough for the demo and avoids the layoutId reliability risk. If you want to attempt the morph anyway, do it as a follow-up after the rest works.

**Files:**
- Modify: `src/pages/Home.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: Wrap routes in AnimatePresence**

Replace `src/main.tsx` with:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { AnimatePresence } from "framer-motion";
import Home from "./pages/Home";
import Scan from "./pages/Scan";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<Home />} />
        <Route path="/scan/:id" element={<Scan />} />
      </Routes>
    </AnimatePresence>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      <BrowserRouter>
        <AnimatedRoutes />
      </BrowserRouter>
    </ConvexProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 2: Replace Home page**

Replace `src/pages/Home.tsx` with:

```tsx
import { useState } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api } from "../../convex/_generated/api";
import Constellation from "../components/Constellation";

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
      // Allow the fade-out animation to play before navigating.
      setTimeout(() => navigate(`/scan/${scanId}`), 220);
    } catch (e: any) {
      alert(e?.message ?? "Failed to start");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 relative overflow-hidden">
      {/* background constellation */}
      <div className="absolute inset-0 flex items-center justify-center opacity-40 pointer-events-none">
        <div className="w-[800px] h-[800px]">
          <Constellation mode="idle" />
        </div>
      </div>

      {/* hero */}
      <div className="relative z-10 min-h-screen flex items-center justify-center p-8">
        <motion.div
          className="w-full max-w-2xl text-center"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >
          <h1 className="text-5xl font-bold mb-3 tracking-tight">Parallel Bug Bounty</h1>
          <p className="text-slate-400 mb-10">150 agents. Every angle. ~90 seconds.</p>

          <motion.div
            className="flex gap-3"
            animate={{ opacity: busy ? 0 : 1, y: busy ? -8 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <input
              className="flex-1 px-4 py-3 bg-slate-900/80 backdrop-blur border border-slate-700 rounded-lg focus:outline-none focus:border-emerald-500"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              disabled={busy}
            />
            <button
              onClick={onSubmit}
              disabled={busy}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg font-medium"
            >
              {busy ? "Starting..." : "Scan"}
            </button>
          </motion.div>

          <div className="mt-8 text-xs font-mono text-slate-500">
            15 angles · 20 concurrent · live via convex
          </div>
        </motion.div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Smoke test**

```bash
npm run dev
```

Open `/`. Verify: rotating constellation drifts behind the hero text, twinkles on individual nodes, hero text stays sharp on top. Click Scan with a valid URL — input fades, then route changes to scan page within ~250ms. Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add src/main.tsx src/pages/Home.tsx
git commit -m "ui: Home hero with constellation background + fade-out on launch"
```

---

## Task 9: Wire Scan page to Constellation, delete AngleGrid + countsByAngle

**Files:**
- Modify: `src/pages/Scan.tsx`
- Delete: `src/components/AngleGrid.tsx`
- Modify: `convex/findings.ts`

- [ ] **Step 1: Replace Scan.tsx**

Replace `src/pages/Scan.tsx` with:

```tsx
import { useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import Constellation, { type AngleSummary } from "../components/Constellation";
import FindingsTable from "../components/FindingsTable";
import { useActiveAngle } from "../lib/useActiveAngle";

export default function Scan() {
  const { id } = useParams<{ id: string }>();
  const scanId = id as Id<"scans">;

  const scan = useQuery(api.scans.get, { scanId });
  const findings = useQuery(api.findings.byScan, { scanId });
  const summaries = (useQuery(api.findings.angleSummaries, { scanId }) ?? []) as AngleSummary[];
  const activeAngle = useActiveAngle(summaries);

  if (!scan) {
    return <div className="min-h-screen bg-slate-950 text-slate-100 p-8">Loading…</div>;
  }

  const elapsed = scan.finishedAt
    ? Math.round((scan.finishedAt - scan.startedAt) / 1000)
    : Math.round((Date.now() - scan.startedAt) / 1000);

  const pct = scan.totalAgents > 0 ? Math.round((scan.completedAgents / scan.totalAgents) * 100) : 0;
  const ranked = scan.status === "done";

  return (
    <motion.div
      className="min-h-screen bg-slate-950 text-slate-100 p-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <div className="text-sm text-slate-400 font-mono break-all">{scan.repoUrl}</div>
          <div className="flex items-center gap-4 mt-2">
            <StatusBadge status={scan.status} />
            <div className="text-slate-400 text-sm">{elapsed}s elapsed</div>
            {scan.error && <div className="text-red-400 text-sm">Error: {scan.error}</div>}
          </div>
        </div>

        <div className="bg-slate-950 border border-slate-900 rounded-xl p-4" style={{ height: 520 }}>
          <Constellation
            mode="live"
            summaries={summaries}
            centerLabel={`${scan.completedAgents} / ${scan.totalAgents || "?"}`}
            activeAngle={activeAngle}
          />
        </div>

        <div>
          <div className="flex justify-between text-sm text-slate-400 mb-2">
            <span>Agents</span>
            <span className="font-mono">
              {scan.completedAgents} / {scan.totalAgents || "?"}
            </span>
          </div>
          <div className="h-1 bg-slate-900 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-1000 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div>
          <h2 className="text-sm uppercase tracking-wider text-slate-500 mb-3">
            Findings {ranked && <span className="text-emerald-400">· ranked</span>}
          </h2>
          <FindingsTable findings={(findings ?? []) as any} ranked={ranked} />
        </div>
      </div>
    </motion.div>
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

- [ ] **Step 2: Delete AngleGrid**

```bash
git rm src/components/AngleGrid.tsx
```

- [ ] **Step 3: Remove countsByAngle from convex/findings.ts**

Delete the `countsByAngle` export from `convex/findings.ts` (lines 14–25 in the original file).

- [ ] **Step 4: Smoke test**

```bash
npm run dev
```

Run a scan from Home. Verify scan page shows constellation panel instead of the grid; nodes light up as findings stream in. No console errors. Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Scan.tsx convex/findings.ts
git rm src/components/AngleGrid.tsx
git commit -m "ui: scan page uses Constellation; remove AngleGrid + countsByAngle"
```

---

## Task 10: Build TopFindingCard component

**Files:**
- Create: `src/components/TopFindingCard.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/TopFindingCard.tsx`:

```tsx
import { motion } from "framer-motion";
import { SEVERITY_HEX, severityTier } from "../lib/severity";
import type { FindingRow } from "./FindingsTable";

export default function TopFindingCard({ finding }: { finding: FindingRow }) {
  const sev = finding.reducerSeverity ?? finding.severity;
  const tier = severityTier(sev);
  const color = SEVERITY_HEX[tier];

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="rounded-xl bg-slate-900 p-5"
      style={{
        border: `1px solid ${color}99`,
        boxShadow: `0 0 24px ${color}66`,
      }}
    >
      <div className="flex items-start gap-4">
        <span
          className="inline-flex items-center justify-center w-12 h-12 rounded-md font-bold text-lg flex-shrink-0"
          style={{ background: color, color: tier === "medium" || tier === "low" ? "#0b1220" : "white" }}
        >
          {Math.round(sev)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Top finding</div>
          <div className="text-lg font-semibold truncate">{finding.title}</div>
          <div className="text-xs text-slate-400 font-mono mt-1 truncate">
            {finding.angle} · {finding.file}:{finding.lineStart}-{finding.lineEnd}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Smoke test by temporarily mounting on Scan page**

In `src/pages/Scan.tsx`, near the findings header, add (temporarily):

```tsx
{ranked && findings && findings.length > 0 && (
  <TopFindingCard finding={findings[0] as any} />
)}
```

Plus the import. (Final wiring with proper sort order happens in Task 13.)

```bash
npm run dev
```

Run a scan to completion. Verify a glowing card appears above the table after status flips to `done`. Stop dev server. Leave the temp mount in place.

- [ ] **Step 3: Commit**

```bash
git add src/components/TopFindingCard.tsx src/pages/Scan.tsx
git commit -m "ui: TopFindingCard component"
```

---

## Task 11: Build SeveritySparkline component

**Files:**
- Create: `src/components/SeveritySparkline.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/SeveritySparkline.tsx`:

```tsx
import { motion } from "framer-motion";
import { SEVERITY_HEX, severityTier, type SeverityTier } from "../lib/severity";
import type { FindingRow } from "./FindingsTable";

const TIERS: { tier: SeverityTier; label: string }[] = [
  { tier: "critical", label: "Critical" },
  { tier: "high", label: "High" },
  { tier: "medium", label: "Medium" },
  { tier: "low", label: "Low" },
];

export default function SeveritySparkline({ findings }: { findings: FindingRow[] }) {
  const counts: Record<SeverityTier, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    idle: 0,
  };
  for (const f of findings) {
    const sev = f.reducerSeverity ?? f.severity;
    counts[severityTier(sev)] += 1;
  }
  const max = Math.max(1, ...TIERS.map((t) => counts[t.tier]));

  return (
    <div className="flex items-end gap-3 px-1">
      {TIERS.map((t, i) => {
        const n = counts[t.tier];
        const widthPct = (n / max) * 100;
        return (
          <div key={t.tier} className="flex-1">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-slate-400">{t.label}</span>
              <span className="font-mono text-slate-300">{n}</span>
            </div>
            <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: SEVERITY_HEX[t.tier], originX: 0 }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: widthPct / 100 }}
                transition={{ duration: 0.4, delay: i * 0.08, ease: "easeOut" }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Smoke test by temporarily mounting**

In `src/pages/Scan.tsx`, next to the TopFindingCard temp mount:

```tsx
{ranked && findings && findings.length > 0 && (
  <SeveritySparkline findings={findings as any} />
)}
```

```bash
npm run dev
```

Run a scan to completion. Verify 4 bars labeled Critical/High/Medium/Low fill from left at slight stagger. Stop dev server. Leave temp mount in place.

- [ ] **Step 3: Commit**

```bash
git add src/components/SeveritySparkline.tsx src/pages/Scan.tsx
git commit -m "ui: SeveritySparkline component"
```

---

## Task 12: FindingsTable row stagger + pulse-wave prop

**Files:**
- Modify: `src/components/FindingsTable.tsx`

- [ ] **Step 1: Rewrite FindingsTable with stagger**

Replace `src/components/FindingsTable.tsx` with:

```tsx
import { useState } from "react";
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
}: {
  findings: FindingRow[];
  ranked: boolean;
  /** Timestamp (ms) at which to play the badge pulse wave; pass Date.now() once. */
  pulseWaveAt?: number;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const visible = ranked
    ? findings.filter((f) => f.reducerKept !== false).sort((a, b) => (a.reducerRank ?? 999) - (b.reducerRank ?? 999))
    : [...findings].sort((a, b) => b.severity - a.severity);

  if (visible.length === 0) {
    return <div className="text-slate-500 text-sm py-8 text-center">No findings yet…</div>;
  }

  // While the pulse wave is active (within 600ms of pulseWaveAt), each row's badge
  // pulses at a stagger of 600ms / visible.length.
  const wavePerRowMs = visible.length > 0 ? Math.min(600 / visible.length, 60) : 0;
  const waveActive = pulseWaveAt !== undefined && Date.now() - pulseWaveAt < 600 + visible.length * wavePerRowMs;

  return (
    <div className="space-y-2">
      <AnimatePresence initial={false}>
        {visible.map((f, i) => (
          <motion.div
            key={f._id}
            layout
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, delay: ranked ? i * 0.03 : 0 }}
            className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden"
          >
            <button
              className="w-full flex items-start gap-4 p-4 text-left hover:bg-slate-800/50"
              onClick={() => setExpanded(expanded === f._id ? null : f._id)}
            >
              <SeverityBadge
                severity={f.reducerSeverity ?? f.severity}
                pulse={waveActive}
              />
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
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
```

Note: implementing a true left-to-right wave (each badge pulses with offset) is added in Task 13 alongside the orchestration `useEffect`. For now, all badges pulse together while `waveActive` is true.

- [ ] **Step 2: Smoke test**

```bash
npm run dev
```

Run a scan. As findings stream in (non-ranked), rows fade in smoothly. After scan completes, rows re-sort and stagger-fade. No console errors. Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add src/components/FindingsTable.tsx
git commit -m "ui: FindingsTable row stagger + pulseWave prop"
```

---

## Task 13: Done-state reveal sequence + final wiring

**Files:**
- Modify: `src/pages/Scan.tsx`

This task replaces the temp mounts from Tasks 10–11 with the real orchestration. It also adds the constellation "settle" sweep ring.

- [ ] **Step 1: Add a `revealStage` state machine to Scan**

Replace `src/pages/Scan.tsx` with the final version:

```tsx
import { useEffect, useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import Constellation, { type AngleSummary } from "../components/Constellation";
import FindingsTable, { type FindingRow } from "../components/FindingsTable";
import TopFindingCard from "../components/TopFindingCard";
import SeveritySparkline from "../components/SeveritySparkline";
import { useActiveAngle } from "../lib/useActiveAngle";

type RevealStage = "idle" | "settle" | "hero" | "sparkline" | "table" | "wave" | "done";

export default function Scan() {
  const { id } = useParams<{ id: string }>();
  const scanId = id as Id<"scans">;

  const scan = useQuery(api.scans.get, { scanId });
  const findings = useQuery(api.findings.byScan, { scanId });
  const summaries = (useQuery(api.findings.angleSummaries, { scanId }) ?? []) as AngleSummary[];
  const activeAngle = useActiveAngle(summaries);

  const [stage, setStage] = useState<RevealStage>("idle");
  const [pulseWaveAt, setPulseWaveAt] = useState<number | undefined>();

  // Trigger the reveal sequence once when status flips to "done".
  useEffect(() => {
    if (scan?.status !== "done") return;
    if (stage !== "idle") return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    setStage("settle");
    timers.push(setTimeout(() => setStage("hero"), 300));
    timers.push(setTimeout(() => setStage("sparkline"), 550));
    timers.push(setTimeout(() => setStage("table"), 950));
    timers.push(setTimeout(() => {
      setStage("wave");
      setPulseWaveAt(Date.now());
    }, 1450));
    timers.push(setTimeout(() => setStage("done"), 2100));
    return () => timers.forEach(clearTimeout);
  }, [scan?.status, stage]);

  const ranked = scan?.status === "done";

  const topFinding = useMemo<FindingRow | null>(() => {
    if (!findings || !ranked) return null;
    const kept = findings.filter((f: any) => f.reducerKept !== false);
    if (kept.length === 0) return null;
    return [...kept].sort((a: any, b: any) => (a.reducerRank ?? 999) - (b.reducerRank ?? 999))[0] as any;
  }, [findings, ranked]);

  if (!scan) {
    return <div className="min-h-screen bg-slate-950 text-slate-100 p-8">Loading…</div>;
  }

  const elapsed = scan.finishedAt
    ? Math.round((scan.finishedAt - scan.startedAt) / 1000)
    : Math.round((Date.now() - scan.startedAt) / 1000);

  const pct = scan.totalAgents > 0 ? Math.round((scan.completedAgents / scan.totalAgents) * 100) : 0;

  return (
    <motion.div
      className="min-h-screen bg-slate-950 text-slate-100 p-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <div className="text-sm text-slate-400 font-mono break-all">{scan.repoUrl}</div>
          <div className="flex items-center gap-4 mt-2">
            <StatusBadge status={scan.status} />
            <div className="text-slate-400 text-sm">{elapsed}s elapsed</div>
            {scan.error && <div className="text-red-400 text-sm">Error: {scan.error}</div>}
          </div>
        </div>

        <div className="relative bg-slate-950 border border-slate-900 rounded-xl p-4" style={{ height: 520 }}>
          <Constellation
            mode="live"
            summaries={summaries}
            centerLabel={`${scan.completedAgents} / ${scan.totalAgents || "?"}`}
            activeAngle={ranked ? null : activeAngle}
          />
          {/* settle sweep — one outward radial fade when reveal starts */}
          <AnimatePresence>
            {stage === "settle" && (
              <motion.div
                key="sweep"
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
                initial={{ opacity: 0.6 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              >
                <motion.div
                  className="rounded-full"
                  style={{ background: "radial-gradient(circle, #10b98155 0%, transparent 70%)" }}
                  initial={{ width: 100, height: 100 }}
                  animate={{ width: 600, height: 600 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div>
          <div className="flex justify-between text-sm text-slate-400 mb-2">
            <span>Agents</span>
            <span className="font-mono">
              {scan.completedAgents} / {scan.totalAgents || "?"}
            </span>
          </div>
          <div className="h-1 bg-slate-900 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-1000 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <AnimatePresence>
          {topFinding && stageReached(stage, "hero") && (
            <TopFindingCard finding={topFinding} key="top" />
          )}
        </AnimatePresence>

        {ranked && stageReached(stage, "sparkline") && findings && (
          <SeveritySparkline findings={findings as any} />
        )}

        <div>
          <h2 className="text-sm uppercase tracking-wider text-slate-500 mb-3">
            Findings {ranked && <span className="text-emerald-400">· ranked</span>}
          </h2>
          <FindingsTable
            findings={(findings ?? []) as any}
            ranked={ranked && stageReached(stage, "table")}
            pulseWaveAt={pulseWaveAt}
          />
        </div>
      </div>
    </motion.div>
  );
}

function stageReached(stage: RevealStage, target: RevealStage): boolean {
  const order: RevealStage[] = ["idle", "settle", "hero", "sparkline", "table", "wave", "done"];
  return order.indexOf(stage) >= order.indexOf(target);
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

- [ ] **Step 2: Full smoke test against acceptance criteria**

```bash
npm run dev
```

Verify all 5 acceptance criteria from the spec:

1. **Home idle in <200ms.** Open `/`. Confirm hero + drifting constellation appear immediately.
2. **Launch morph (no hard cut).** Click Scan with `https://github.com/OWASP/NodeGoat`. Input fades, constellation continuity into scan view.
3. **Live constellation responds.** During scan, watch nodes grow/color/pulse as findings stream. Latency under ~500ms relative to dev console showing convex query updates.
4. **Done-state reveal under 1.5s.** When status flips to `done`, observe in order: sweep ring → top-finding card → sparkline bars → table re-sort with stagger → badge pulse wave. Total < ~2s end-to-end.
5. **No console errors / no layout shift after mount / 60fps.** Open dev tools Performance tab during the reveal; confirm no red bars and >50fps. No console errors.

If any criterion fails, fix in this task before committing.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Scan.tsx
git commit -m "ui: done-state reveal sequence (settle → hero → sparkline → table → wave)"
```

---

## Task 14: Final polish pass

**Files:**
- Modify: any of the above

Sweep for the small things that always slip through hackathon work.

- [ ] **Step 1: Run typecheck and lint**

```bash
npm run build
```

Expected: clean. Fix any TS errors inline.

```bash
npm run lint
```

Expected: clean or only pre-existing warnings. Fix new warnings.

- [ ] **Step 2: Re-test the launch morph specifically**

The cross-route AnimatePresence is the most fragile piece. If the morph looks abrupt:
- Confirm `<Routes location={location} key={location.pathname}>` is set in `src/main.tsx`.
- Confirm both Home and Scan pages have a top-level `<motion.div>` with `exit` defined.
- If still abrupt, accept the fallback (200ms crossfade is what we already have via `motion.div` exit) and document.

- [ ] **Step 3: Update README screenshots**

```bash
ls docs/
# home.png, scan-running.png, scan-done.png exist; replace if time permits
```

If time permits, capture fresh PNGs of the new UI and overwrite `docs/home.png`, `docs/scan-running.png`, `docs/scan-done.png`. Skip if running low on time.

- [ ] **Step 4: Final commit**

If any fixes were made:

```bash
git add -p
git commit -m "polish: typecheck/lint cleanup + reveal sequence tuning"
```

If nothing needed fixing, no commit needed.

---

## Self-Review Checklist (for the implementer)

Before declaring done, walk back through the spec acceptance criteria and confirm each is met. If any animation feels off, tweak the timing constants in Task 13's `useEffect` chain — they're tuned by feel, not derived. Don't ship if Acceptance Criterion 5 (no errors, no layout shift) fails; that's a credibility tax during the demo.
