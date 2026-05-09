import { severityTier } from "../lib/severity";

export default function SeverityBadge({
  severity,
  pulse = false,
}: {
  severity: number;
  pulse?: boolean;
}) {
  const s = Math.max(1, Math.min(10, Math.round(severity)));
  const tier = severityTier(s);
  const bgClass = {
    critical: "bg-severity-critical text-white",
    high: "bg-severity-high text-white",
    medium: "bg-severity-medium text-slate-900",
    low: "bg-severity-low text-slate-900",
    idle: "bg-severity-idle text-slate-100",
  }[tier];
  const pulseClass = pulse ? "ring-2 ring-white/40" : "";
  return (
    <span
      className={`inline-flex items-center justify-center w-8 h-8 rounded-md font-bold text-sm transition-all duration-300 ${bgClass} ${pulseClass}`}
    >
      {s}
    </span>
  );
}
