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

1. `npm run dev` (Convex dev must already be running in another terminal)
2. Open the printed localhost URL, paste any public GitHub URL, click Scan.
3. Watch findings stream in real-time via Convex queries (no polling code).

## Built at Weekend Build with Codex, May 9 2026, HCMC
