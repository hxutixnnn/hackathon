import { useState } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api } from "../../convex/_generated/api";
import Constellation from "../components/Constellation";

export default function Home() {
  const [url, setUrl] = useState("https://github.com/OWASP/NodeGoat");
  const [busy, setBusy] = useState(false);
  const start = useMutation(api.scans.start);
  const navigate = useNavigate();

  const onSubmit = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      const scanId = await start({ repoUrl: url.trim() });
      // Allow the fade-out animation to play before navigating.
      setTimeout(() => navigate(`/scan/${scanId}`), 220);
    } catch (e: any) {
      alert(e?.message ?? "Failed to start");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 relative overflow-hidden">
      {/* background constellation */}
      <div className="absolute inset-0 flex items-center justify-center opacity-40 pointer-events-none">
        <div className="w-[800px] h-[800px]">
          <Constellation mode="idle" />
        </div>
      </div>

      {/* hero */}
      <div className="relative z-10 min-h-screen flex items-center justify-center p-8">
        <motion.div
          className="w-full max-w-2xl text-center"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >
          <h1 className="text-5xl font-bold mb-3 tracking-tight">Parallel Bug Bounty</h1>
          <p className="text-slate-400 mb-10">150 agents. Every angle. ~90 seconds.</p>

          <motion.div
            className="flex gap-3"
            animate={{ opacity: busy ? 0 : 1, y: busy ? -8 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <input
              className="flex-1 px-4 py-3 bg-slate-900/80 backdrop-blur border border-slate-700 rounded-lg focus:outline-none focus:border-emerald-500"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              disabled={busy}
            />
            <button
              onClick={onSubmit}
              disabled={busy}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg font-medium"
            >
              {busy ? "Starting..." : "Scan"}
            </button>
          </motion.div>

          <div className="mt-8 text-xs font-mono text-slate-500">
            15 angles · 20 concurrent · live via convex
          </div>
        </motion.div>
      </div>
    </div>
  );
}
