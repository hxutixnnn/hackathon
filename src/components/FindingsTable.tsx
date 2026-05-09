import { useEffect, useRef, useState } from "react";
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
  matchedFindingIds,
  onSelect,
  topThreeIds,
}: {
  findings: FindingRow[];
  ranked: boolean;
  pulseWaveAt?: number;
  matchedFindingIds?: string[];
  onSelect?: (finding: FindingRow) => void;
  topThreeIds?: Set<string>;
}) {
  const [waveActive, setWaveActive] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matched = new Set(matchedFindingIds ?? []);

  // Dedup pipeline only sets reducerKept; reducerRank/Severity are no longer populated.
  // In ranked mode, show kept findings sorted by severity desc.
  const visible = ranked
    ? findings.filter((f) => f.reducerKept !== false).sort((a, b) => b.severity - a.severity)
    : [...findings].sort((a, b) => b.severity - a.severity);

  const wavePerRowMs = visible.length > 0 ? Math.min(600 / visible.length, 60) : 0;

  useEffect(() => {
    if (pulseWaveAt === undefined) return;
    const duration = 600 + visible.length * wavePerRowMs;
    const activateTimer = setTimeout(() => {
      setWaveActive(true);
      const deactivateTimer = setTimeout(() => setWaveActive(false), duration);
      timerRef.current = deactivateTimer;
    }, 0);
    return () => {
      clearTimeout(activateTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pulseWaveAt, visible.length, wavePerRowMs]);

  if (visible.length === 0) {
    return <div className="text-slate-500 text-sm py-8 text-center">No findings yet…</div>;
  }

  return (
    <div className="space-y-2">
      <AnimatePresence initial={false}>
        {visible.map((f, i) => (
          <motion.button
            key={f._id}
            layout
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, delay: ranked ? i * 0.03 : 0 }}
            onClick={() => onSelect?.(f)}
            className="w-full text-left bg-slate-900 border border-slate-800 rounded-lg p-4 flex items-start gap-4 hover:bg-slate-800/50 hover:border-slate-700 cursor-pointer"
          >
            <SeverityBadge
              severity={f.reducerSeverity ?? f.severity}
              pulse={waveActive}
            />
            {matched.has(f._id) && (
              <span
                className="mt-2 inline-block h-2 w-2 rounded-full bg-emerald-400 shrink-0"
                title="matches juice-shop ground truth"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="font-medium truncate">{f.title}</div>
                {topThreeIds?.has(f._id) && (
                  <span className="text-xs bg-emerald-900/50 text-emerald-300 px-2 py-0.5 rounded shrink-0">
                    ✨ Studio ready
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500 font-mono mt-1">
                {f.angle} · {f.file}:{f.lineStart}-{f.lineEnd}
              </div>
            </div>
            <div className="text-slate-500 text-xs">→</div>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
