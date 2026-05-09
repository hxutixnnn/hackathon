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
