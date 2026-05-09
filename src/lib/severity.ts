export type SeverityTier = "critical" | "high" | "medium" | "low" | "idle";

export function severityTier(severity: number | null | undefined): SeverityTier {
  if (severity == null) return "idle";
  const s = Math.round(severity);
  if (s >= 9) return "critical";
  if (s >= 7) return "high";
  if (s >= 5) return "medium";
  if (s >= 3) return "low";
  return "idle";
}

export const SEVERITY_HEX: Record<SeverityTier, string> = {
  critical: "#ef4444",
  high: "#f59e0b",
  medium: "#eab308",
  low: "#10b981",
  idle: "#475569",
};

// Tailwind class fragments (use as template literals only — Tailwind cannot scan dynamic class names)
export const SEVERITY_BG_CLASS: Record<SeverityTier, string> = {
  critical: "bg-severity-critical",
  high: "bg-severity-high",
  medium: "bg-severity-medium",
  low: "bg-severity-low",
  idle: "bg-severity-idle",
};
