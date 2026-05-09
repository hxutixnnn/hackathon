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
