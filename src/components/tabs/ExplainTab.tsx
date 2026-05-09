// src/components/tabs/ExplainTab.tsx
import ReactMarkdown from "react-markdown";

export default function ExplainTab({
  finding,
  row,
}: {
  finding: { lineStart: number; lineEnd: number; evidence: string };
  row: {
    status: "pending" | "running" | "done" | "error";
    explainMarkdown?: string;
    codeSnippet?: string;
    error?: string;
  } | null;
}) {
  const snippet = row?.codeSnippet ?? finding.evidence;

  return (
    <div className="space-y-4">
      <pre className="text-xs bg-slate-900 p-3 rounded overflow-x-auto border border-slate-800">
        {renderHighlighted(snippet, finding.lineStart, finding.lineEnd)}
      </pre>

      {row?.status === "done" && row.explainMarkdown && (
        <div className="prose prose-invert prose-sm max-w-none">
          <ReactMarkdown>{row.explainMarkdown}</ReactMarkdown>
        </div>
      )}

      {(row === null || row.status === "running" || row.status === "pending") && (
        <SkeletonLines />
      )}

      {row?.status === "error" && (
        <div className="bg-red-950/50 border border-red-800 rounded p-3 text-sm">
          <div className="text-red-300 font-medium">Generation failed</div>
          <div className="text-red-400/80 text-xs mt-1 font-mono">{row.error}</div>
        </div>
      )}
    </div>
  );
}

function renderHighlighted(snippet: string, lineStart: number, lineEnd: number) {
  const lines = snippet.split("\n");
  return lines.map((line, i) => {
    const lineMatch = line.match(/^\s*(\d+):/);
    const lineNo = lineMatch ? parseInt(lineMatch[1], 10) : i + 1;
    const isVuln = lineNo >= lineStart && lineNo <= lineEnd;
    return (
      <div
        key={i}
        className={isVuln ? "bg-red-900/40 -mx-3 px-3" : ""}
      >
        {line || " "}
      </div>
    );
  });
}

function SkeletonLines() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-3 bg-slate-800 rounded w-3/4" />
      <div className="h-3 bg-slate-800 rounded w-full" />
      <div className="h-3 bg-slate-800 rounded w-5/6" />
      <div className="h-3 bg-slate-800 rounded w-2/3 mt-4" />
      <div className="h-3 bg-slate-800 rounded w-4/5" />
    </div>
  );
}
