type Props = {
  totalAgents: number;
  completedAgents: number;
  cacheHits: number;
  cacheMisses: number;
  rawFindings: number;
  keptFindings: number;
};

export function StatsBar({
  totalAgents,
  completedAgents,
  cacheHits,
  cacheMisses,
  rawFindings,
  keptFindings,
}: Props) {
  const total = cacheHits + cacheMisses;
  const hitPct = total > 0 ? Math.round((100 * cacheHits) / total) : 0;
  return (
    <div className="grid grid-cols-3 gap-4 rounded border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
      <div>
        <div className="text-xs uppercase text-zinc-500">Agents</div>
        <div className="font-mono text-base text-zinc-100">
          {completedAgents}/{totalAgents}
        </div>
      </div>
      <div>
        <div className="text-xs uppercase text-zinc-500">Cache</div>
        <div className="font-mono text-base text-zinc-100">
          {cacheHits}/{total} hit ({hitPct}%)
        </div>
      </div>
      <div>
        <div className="text-xs uppercase text-zinc-500">Findings</div>
        <div className="font-mono text-base text-zinc-100">
          {rawFindings} → {keptFindings} dedup
        </div>
      </div>
    </div>
  );
}
