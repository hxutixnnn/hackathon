import { SEVERITY_HEX, severityTier, type SeverityTier } from "./severity";

export type AngleSummary = {
  angle: string;
  count: number;
  maxSeverity: number;
  latestAt: number;
};

export function nodeStyleFor(
  summary: AngleSummary | undefined,
): { radius: number; tier: SeverityTier; fill: string } {
  if (!summary || summary.count === 0) {
    return { radius: 8, tier: "idle", fill: SEVERITY_HEX.idle };
  }
  const radius = 8 + Math.min(summary.count * 1.2, 16);
  const tier = severityTier(summary.maxSeverity);
  return { radius, tier, fill: SEVERITY_HEX[tier] };
}
