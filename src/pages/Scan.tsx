import { useEffect, useState, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import Constellation from "../components/Constellation";
import type { AngleSummary } from "../lib/nodeStyle";
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
  const firedRef = useRef(false);

  // Trigger the reveal sequence once when status flips to "done".
  useEffect(() => {
    if (scan?.status !== "done" || firedRef.current) return;
    firedRef.current = true;
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
  }, [scan?.status]);

  const ranked = scan?.status === "done";

  const topFinding = useMemo<FindingRow | null>(() => {
    if (!findings || !ranked) return null;
    const kept = findings.filter((f) => f.reducerKept !== false);
    if (kept.length === 0) return null;
    const sorted = [...kept].sort((a, b) => (a.reducerRank ?? 999) - (b.reducerRank ?? 999));
    return sorted[0] ?? null;
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
          <SeveritySparkline findings={findings as FindingRow[]} />
        )}

        <div>
          <h2 className="text-sm uppercase tracking-wider text-slate-500 mb-3">
            Findings {ranked && <span className="text-emerald-400">· ranked</span>}
          </h2>
          <FindingsTable
            findings={(findings ?? []) as FindingRow[]}
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
