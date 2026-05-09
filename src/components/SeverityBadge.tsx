export default function SeverityBadge({ severity }: { severity: number }) {
  const s = Math.max(1, Math.min(10, Math.round(severity)));
  const cls =
    s >= 9 ? "bg-red-600 text-white" :
    s >= 7 ? "bg-orange-500 text-white" :
    s >= 5 ? "bg-yellow-500 text-slate-900" :
    s >= 3 ? "bg-blue-500 text-white" :
              "bg-slate-600 text-slate-100";
  return (
    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-md font-bold text-sm ${cls}`}>
      {s}
    </span>
  );
}
