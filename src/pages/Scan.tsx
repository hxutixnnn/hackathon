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
