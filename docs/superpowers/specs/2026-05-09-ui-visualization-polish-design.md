# UI Visualization Polish — Design Spec

**Date:** 2026-05-09
**Status:** Approved
**Scope:** Coordinated motion arc across Home, Scan-running, Scan-done. Replaces current angle grid with constellation visualization. Slick product polish, not cinematic hacker theme.

## Goal

Make the demo visceral. The product *is* parallel orchestration — the UI must show parallelism happening in real time. Current UI (static grid + table) does not. Constellation visualization conveys 15 angles + live agent activity in one frame.

## Visual language

Single metaphor across all three surfaces: **constellation** — center node = repo under test, 15 outer nodes orbit at fixed angles = the 15 attack-angle auditors. Same SVG component reused (idle on Home, live on Scan).

### Color tokens (extend `tailwind.config.js`)

```
severity.critical  #ef4444
severity.high      #f59e0b
severity.medium    #eab308
severity.low       #10b981
severity.idle      #475569
```

Used by: constellation node fill, severity badges, top-finding hero card border-glow, sparkline bars.

## Surface 1: Home (idle)

**Layout:** existing centered hero (title + tagline + URL input + Scan button). Add constellation as background layer behind hero, full viewport, opacity ~0.4.

**Constellation idle behavior:**
- 15 nodes at fixed polar positions around center.
- All nodes `severity.idle` color, radius 6px.
- Group `<g>` rotates 360° over 60s linear infinite (CSS `@keyframes`).
- Each node twinkles independently: opacity 0.3 ↔ 0.6, 4s ease-in-out, randomized `animation-delay` (0–4s).
- Lines stroke `slate-800`, no animation.

**No JS required for idle.** Pure CSS keyframes + inline-styled delays.

## Surface 2: Launch transition (Scan click → /scan/:id)

When user submits valid URL:
1. URL input + Scan button fade out (200ms).
2. Center node of background constellation scales 1 → 1.4 (200ms ease-out) and brightens to `emerald-500` full opacity.
3. Route navigates to `/scan/:id`.
4. Scan view mounts with constellation already centered and same scale; uses Framer Motion `layoutId="constellation-center"` shared between Home and Scan to morph automatically.

Effect: continuity from form to live view. Judge sees the dot they clicked become the live scan.

## Surface 3: Scan running

**Layout (top → bottom):**
1. Header strip: repo URL (mono, truncated), `StatusBadge`, elapsed seconds.
2. Constellation panel, ~480px tall, full width of `max-w-5xl` container, dark `slate-950` background, `slate-900` rounded border.
3. Progress bar (existing) — keep, refine to 4px height, `emerald-500` fill, smoother transition (1s ease).
4. Findings table (existing component, with row-stagger added).

**Constellation live behavior:**
- 15 outer nodes mapped 1:1 to angles in fixed order (matches `ANGLE_LABELS` from current `AngleGrid.tsx`).
- Per-node binding driven by new query `api.findings.angleSummaries`:
  - radius: `8 + clamp(count * 1.2, 0, 16)` → range 8–24px
  - fill color: `severity[maxSeverity]` (idle if count = 0)
- "Most recent activity" pulse: client tracks max `_creationTime` across all findings; the angle of that finding gets `animate-pulse` (scale 1 → 1.2, 800ms ease-in-out). Pulse stops when either (a) a newer finding arrives in a different angle (pulse moves to that node), or (b) 1.5s have elapsed since that finding's `_creationTime`. Derivation debounced by 200ms to avoid flicker on burst arrivals.
- Center node shows live agent counter `{completedAgents}/{totalAgents}` in mono, 14px.
- Lines from center to each node: stroke opacity scales with that angle's count (0.2 idle → 0.8 saturated).
- No idle rotation in scan view (idle rotation is a Home-only signal that nothing is happening).

**Convex query (new):** `convex/findings.ts` — add `angleSummaries({scanId})` returning `Array<{angle: string, count: number, maxSeverity: "critical"|"high"|"medium"|"low"}>`. Replaces `countsByAngle` (delete after migration).

## Surface 4: Scan done (findings reveal)

Triggered when `scan.status === "done"`. Single `useEffect` chains the sequence via `setTimeout`:

| t (ms) | event |
|---|---|
| 0 | constellation pulse loops stop; one outward sweep ring (radial fade, `emerald-500/30 → 0`, 300ms) |
| 300 | top-finding hero card slides down + fades in (250ms ease-out) |
| 550 | severity sparkline strip animates: 4 bars scaleY 0 → 1 (400ms ease-out, 80ms stagger) |
| 950 | findings table re-sorts to ranked order; rows fade in top-to-bottom, 30ms stagger between rows |
| 1450 | severity badges in table color-pulse left-to-right (one wave, 600ms) |

Total reveal under 1.5s. Constellation persists at top as anchor.

**TopFindingCard** (new component, ~40 LOC):
- Position: above findings table, below progress bar.
- Picks first finding when sorted by severity desc → confidence desc.
- Severity glow: `box-shadow: 0 0 24px <severity-color>/40`, border 1px `<severity-color>/60`.
- Body: severity badge, file path (mono, truncated), one-line summary, "View" link that scrolls to row in table.

**SeveritySparkline** (new component, ~30 LOC):
- 4 horizontal bars, one per severity tier, width = max-content.
- Each bar: label + count + filled bar (length proportional to max count across tiers).
- Lives in a strip just above the findings table heading.

## Component changes

| File | Change |
|---|---|
| `src/pages/Home.tsx` | Wrap in `Constellation idle` background layer. Replace navigate with input fade + layoutId morph. |
| `src/pages/Scan.tsx` | Replace `<AngleGrid />` with `<Constellation scanId live />`. Add `<TopFindingCard />` and `<SeveritySparkline />` (rendered only when `scan.status === "done"`). Add `useEffect` reveal sequence. |
| `src/components/Constellation.tsx` | NEW. Modes: `idle` (Home) and `live` (Scan). ~150 LOC. SVG only. |
| `src/components/TopFindingCard.tsx` | NEW. ~40 LOC. |
| `src/components/SeveritySparkline.tsx` | NEW. ~30 LOC. |
| `src/components/FindingsTable.tsx` | Wrap row mapping in Framer `<AnimatePresence>`; rows use `motion.tr` with stagger via `transition.delay`. |
| `src/components/AngleGrid.tsx` | DELETE. |
| `src/components/SeverityBadge.tsx` | Refactor to use new `severity.*` tailwind tokens. Add `pulse` prop for done-state wave. |
| `convex/findings.ts` | Add `angleSummaries` query. Remove `countsByAngle` (no other consumers after deletion of AngleGrid). |
| `tailwind.config.js` | Extend theme.colors with `severity.*` palette. |
| `package.json` | Add `framer-motion`. |

## Dependencies

- `framer-motion` (latest, ~50KB gzipped). Justification: shared `layoutId` morph between Home → Scan + `AnimatePresence` for table row stagger. Replacing with hand-rolled CSS would cost more LOC and lose the morph.

## Out of scope (YAGNI)

- Sound effects.
- WebGL / Canvas (15 nodes does not warrant either).
- Lottie / video assets.
- Charting library (sparkline = 4 divs).
- Theme switcher (dark only).
- Custom display font (system / Inter only).
- Mobile-specific layouts (demo is desktop).

## Acceptance criteria

1. Loading `/` shows hero with constellation drifting/twinkling behind it within 200ms.
2. Clicking Scan with a valid URL produces a visible morph from input area to scan view (no hard cut).
3. Scan-running view shows constellation responding live: nodes grow, change color, pulse on new findings, within ~500ms of the underlying convex query update.
4. When `scan.status` becomes `done`, the reveal sequence completes within 1.5s with all four animations playing in order without overlap stutter.
5. No console errors, no layout shift after initial mount, no dropped frames in dev build at 60fps on M-series MacBook.

## Risk and mitigation

- **Framer layoutId morph across route changes requires special setup.** `layoutId` only animates within a shared `<AnimatePresence>` tree; routes mounted by react-router are not in the same tree by default. Mitigation: wrap the `<Routes>` in `<AnimatePresence mode="wait">` keyed on `location.pathname` and ensure both Home and Scan render the constellation node with the same `layoutId`. If still unreliable, fall back to a CSS-only crossfade (200ms opacity) and accept the loss of continuity. Test early.
- **`angleSummaries` query may need an index.** Mitigation: add appropriate index on `findings` table by `scanId` and `angle` if not already present.
- **Pulse-on-most-recent client tracking can flicker if findings arrive in bursts.** Mitigation: debounce the "active angle" derivation by 200ms.
