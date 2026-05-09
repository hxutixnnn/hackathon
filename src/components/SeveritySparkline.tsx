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
