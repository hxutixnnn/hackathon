import { useState } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "../../convex/_generated/api";

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
      navigate(`/scan/${scanId}`);
    } catch (e: any) {
      alert(e?.message ?? "Failed to start");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        <h1 className="text-4xl font-bold mb-2">Parallel Bug Bounty</h1>
        <p className="text-slate-400 mb-8">Paste a public GitHub repo. 150 agents will audit it in parallel.</p>
        <div className="flex gap-3">
          <input
            className="flex-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
          />
          <button
            onClick={onSubmit}
            disabled={busy}
            className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg font-medium"
          >
            {busy ? "Starting..." : "Scan"}
          </button>
        </div>
      </div>
    </div>
  );
}
