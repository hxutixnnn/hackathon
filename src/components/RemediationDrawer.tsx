// src/components/RemediationDrawer.tsx
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import SeverityBadge from "./SeverityBadge";
import ExplainTab from "./tabs/ExplainTab";
import ProveTab from "./tabs/ProveTab";
import FixTab from "./tabs/FixTab";

type Kind = "explain" | "prove" | "fix";

export default function RemediationDrawer({
  finding,
  onClose,
}: {
  finding: {
    _id: Id<"findings">;
    title: string;
    file: string;
    lineStart: number;
    lineEnd: number;
    severity: number;
    angle: string;
    description: string;
    evidence: string;
    reducerSeverity?: number;
  } | null;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<Kind>("explain");
  const remediations = useQuery(
    api.studio.byFinding,
    finding ? { findingId: finding._id } : "skip",
  );
  const ensure = useAction(api.studio.ensure);

  useEffect(() => {
    if (finding) {
      setActiveTab("explain");
      ensure({ findingId: finding._id, kind: "explain" }).catch(() => {});
    }
  }, [finding?._id, ensure]);

  return (
    <AnimatePresence>
      {finding && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black z-40"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 240 }}
            className="fixed top-0 right-0 h-full w-full md:w-1/2 bg-slate-950 border-l border-slate-800 z-50 flex flex-col"
          >
            <header className="flex items-start gap-3 p-4 border-b border-slate-800">
              <SeverityBadge severity={finding.reducerSeverity ?? finding.severity} />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{finding.title}</div>
                <div className="text-xs text-slate-500 font-mono mt-1">
                  {finding.angle} · {finding.file}:{finding.lineStart}-{finding.lineEnd}
                </div>
              </div>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-100 px-2">
                ✕
              </button>
            </header>

            <nav className="flex border-b border-slate-800">
              {(["explain", "prove", "fix"] as Kind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    setActiveTab(k);
                    if (k !== "explain") {
                      ensure({ findingId: finding._id, kind: k }).catch(() => {});
                    }
                  }}
                  className={`px-4 py-3 text-sm uppercase tracking-wider ${
                    activeTab === k
                      ? "text-emerald-400 border-b-2 border-emerald-400"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {k}
                </button>
              ))}
            </nav>

            <div className="flex-1 overflow-y-auto p-4">
              {activeTab === "explain" && (
                <ExplainTab finding={finding} row={remediations?.explain ?? null} />
              )}
              {activeTab === "prove" && (
                <ProveTab finding={finding} row={remediations?.prove ?? null} />
              )}
              {activeTab === "fix" && (
                <FixTab finding={finding} row={remediations?.fix ?? null} />
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
