import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const ANGLE_LABELS: { id: string; label: string }[] = [
  { id: "sql_injection", label: "SQLi" },
  { id: "command_injection", label: "Cmd Inj" },
  { id: "path_traversal", label: "Path" },
  { id: "ssrf", label: "SSRF" },
  { id: "xss", label: "XSS" },
  { id: "authn_bypass", label: "Authn" },
  { id: "authz_idor", label: "IDOR" },
  { id: "secrets", label: "Secrets" },
  { id: "weak_crypto", label: "Crypto" },
  { id: "deserialization", label: "Deser" },
  { id: "race", label: "Race" },
  { id: "proto_pollution", label: "Proto" },
  { id: "open_redirect", label: "Redir" },
  { id: "vuln_deps", label: "Deps" },
  { id: "csrf", label: "CSRF" },
];

export default function AngleGrid({ scanId }: { scanId: Id<"scans"> }) {
  const counts = useQuery(api.findings.countsByAngle, { scanId }) ?? {};
  return (
    <div className="grid grid-cols-5 md:grid-cols-8 lg:grid-cols-15 gap-2">
      {ANGLE_LABELS.map((a) => {
        const n = counts[a.id] ?? 0;
        const cls = n > 0 ? "bg-emerald-600/30 border-emerald-500 text-emerald-200" : "bg-slate-900 border-slate-800 text-slate-500";
        return (
          <div key={a.id} className={`px-2 py-2 rounded border text-center ${cls}`}>
            <div className="text-xs font-mono">{a.label}</div>
            <div className="text-lg font-bold">{n}</div>
          </div>
        );
      })}
    </div>
  );
}
