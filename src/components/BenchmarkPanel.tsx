type Benchmark = {
  corpus: string;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
};

export function BenchmarkPanel({ benchmark }: { benchmark: Benchmark | null | undefined }) {
  if (!benchmark) return null;
  const fmt = (n: number) => n.toFixed(2);
  return (
    <div className="rounded border border-emerald-800 bg-emerald-950/30 px-4 py-3 text-sm">
      <div className="mb-2 text-xs uppercase tracking-wider text-emerald-400">
        Benchmark vs {benchmark.corpus}
      </div>
      <div className="grid grid-cols-4 gap-4 font-mono">
        <Metric label="Precision" value={fmt(benchmark.precision)} />
        <Metric label="Recall" value={fmt(benchmark.recall)} />
        <Metric label="F1" value={fmt(benchmark.f1)} accent />
        <Metric
          label="Hits"
          value={`${benchmark.tp}/${benchmark.tp + benchmark.fn}`}
        />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={accent ? "text-lg text-emerald-300" : "text-base text-slate-100"}>
        {value}
      </div>
    </div>
  );
}
