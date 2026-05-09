import { ANGLES } from "../lib/angles";
import { SEVERITY_HEX } from "../lib/severity";
import { nodeStyleFor, type AngleSummary } from "../lib/nodeStyle";

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
        {ANGLE_POSITIONS.map((p) => {
          const summary = isLive
            ? (props as LiveProps).summaries.find((s) => s.angle === p.id)
            : undefined;
          const opacity = isLive ? 0.2 + Math.min((summary?.count ?? 0) * 0.06, 0.6) : 0.5;
          return (
            <line
              key={`l-${p.id}`}
              x1={CENTER}
              y1={CENTER}
              x2={p.x}
              y2={p.y}
              stroke="#1e293b"
              strokeWidth={1}
              opacity={opacity}
              style={{ transition: "opacity 400ms ease" }}
            />
          );
        })}

        {/* outer nodes */}
        {ANGLE_POSITIONS.map((p) => {
          const summary = isLive
            ? (props as LiveProps).summaries.find((s) => s.angle === p.id)
            : undefined;
          const { radius, fill } = nodeStyleFor(summary);
          const isActive = isLive && (props as LiveProps).activeAngle === p.id;
          return (
            <g
              key={`n-${p.id}`}
              className={isActive ? "animate-nodePulse" : ""}
              style={{
                transformOrigin: `${p.x}px ${p.y}px`,
              }}
            >
              <circle
                cx={p.x}
                cy={p.y}
                r={isLive ? radius : 6}
                fill={isLive ? fill : SEVERITY_HEX.idle}
                className={isLive ? "" : "animate-twinkle"}
                style={{
                  animationDelay: isLive ? undefined : `${(p.x + p.y) % 4}s`,
                  transition: "r 400ms ease, fill 400ms ease",
                }}
              />
              {isLive && (
                <text
                  x={p.x}
                  y={p.y + radius + 14}
                  textAnchor="middle"
                  fontSize={10}
                  fontFamily="ui-monospace, monospace"
                  fill="#64748b"
                >
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
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

