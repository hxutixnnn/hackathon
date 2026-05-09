import { ANGLES } from "../lib/angles";
import { SEVERITY_HEX, severityTier, type SeverityTier } from "../lib/severity";

export type AngleSummary = {
  angle: string;
  count: number;
  maxSeverity: number;
  latestAt: number;
};

type IdleProps = {
  mode: "idle";
  centerLabel?: string;
};

type LiveProps = {
  mode: "live";
  summaries: AngleSummary[];
  centerLabel: string; // e.g. "42 / 150"
  activeAngle: string | null;
};

export type ConstellationProps = (IdleProps | LiveProps) & {
  className?: string;
};

const VIEW = 600; // square viewBox
const CENTER = VIEW / 2;
const ORBIT = 220;

// Precompute orbit positions for the 15 angles, evenly distributed.
const ANGLE_POSITIONS = ANGLES.map((a, i) => {
  const theta = (i / ANGLES.length) * 2 * Math.PI - Math.PI / 2;
  return {
    id: a.id,
    label: a.label,
    x: CENTER + Math.cos(theta) * ORBIT,
    y: CENTER + Math.sin(theta) * ORBIT,
  };
});

export default function Constellation(props: ConstellationProps) {
  const { className = "" } = props;
  // NOTE: TypeScript does not narrow the discriminated union through this boolean.
  // Live-mode-only access to props (e.g. props.summaries) requires `(props as LiveProps)` cast.
  const isLive = props.mode === "live";

  return (
    <svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className={`w-full h-full ${className}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <radialGradient id="centerHalo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* idle: rotate the entire group; live: no rotation */}
      <g
        className={isLive ? "" : "animate-spinSlow"}
        style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
      >
        {/* lines from center to each node */}
        {ANGLE_POSITIONS.map((p) => (
          <line
            key={`l-${p.id}`}
            x1={CENTER}
            y1={CENTER}
            x2={p.x}
            y2={p.y}
            stroke="#1e293b"
            strokeWidth={1}
            opacity={0.5}
          />
        ))}

        {/* outer nodes */}
        {ANGLE_POSITIONS.map((p) => (
          <g key={`n-${p.id}`}>
            <circle
              cx={p.x}
              cy={p.y}
              r={6}
              fill={SEVERITY_HEX.idle}
              className={isLive ? "" : "animate-twinkle"}
              style={{ animationDelay: isLive ? undefined : `${(p.x + p.y) % 4}s` }}
            />
          </g>
        ))}
      </g>

      {/* center node — outside rotating group so labels stay upright */}
      <circle cx={CENTER} cy={CENTER} r={70} fill="url(#centerHalo)" />
      <circle cx={CENTER} cy={CENTER} r={isLive ? 18 : 10} fill="#10b981" />
      {props.centerLabel && (
        <text
          x={CENTER}
          y={CENTER + 4}
          textAnchor="middle"
          fontSize={isLive ? 14 : 8}
          fontFamily="ui-monospace, monospace"
          fill="#0b1220"
          fontWeight={600}
        >
          {props.centerLabel}
        </text>
      )}
    </svg>
  );
}

// Helper exported for Task 6 — derive node radius and color from a summary.
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
