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
