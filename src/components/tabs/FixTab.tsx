import { useState } from "react";
import ReactDiffViewer from "react-diff-viewer-continued";
import ReactMarkdown from "react-markdown";

export default function FixTab({
  finding: _finding,
  row,
}: {
  finding: unknown;
  row: {
    status: "pending" | "running" | "done" | "error";
    patchUnifiedDiff?: string;
    fixSummary?: string;
    fixBody?: string;
    error?: string;
  } | null;
}) {
  const [copied, setCopied] = useState(false);

  if (row === null || row.status === "running" || row.status === "pending") {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-6 bg-slate-800 rounded w-2/3" />
        <div className="h-3 bg-slate-800 rounded w-full" />
        <div className="h-32 bg-slate-900 rounded" />
      </div>
    );
  }

  if (row.status === "error") {
    return (
      <div className="bg-red-950/50 border border-red-800 rounded p-3 text-sm">
        <div className="text-red-300 font-medium">Generation failed</div>
        <div className="text-red-400/80 text-xs mt-1 font-mono">{row.error}</div>
      </div>
    );
  }

  const diff = row.patchUnifiedDiff ?? "";
  const { oldStr, newStr } = parseDiff(diff);
  const empty = oldStr === "" && newStr === "";

  function onFakeOpen() {
    navigator.clipboard.writeText(diff);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-4">
      <div className="border border-slate-800 rounded overflow-hidden">
        <div className="bg-slate-900 px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="bg-emerald-700/40 text-emerald-300 px-2 py-0.5 rounded text-xs">Open</span>
            <span className="font-medium">{row.fixSummary}</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            remediation-studio wants to merge 1 commit
          </div>
        </div>

        {row.fixBody && (
          <div className="p-4 prose prose-invert prose-sm max-w-none border-b border-slate-800">
            <ReactMarkdown>{row.fixBody}</ReactMarkdown>
          </div>
        )}

        {empty ? (
          <div className="p-4 text-sm text-slate-400">
            No fix needed — finding may be a false positive.
          </div>
        ) : (
          <div className="text-xs">
            <ReactDiffViewer
              oldValue={oldStr}
              newValue={newStr}
              splitView={true}
              useDarkTheme={true}
              hideLineNumbers={false}
            />
          </div>
        )}

        <div className="p-4 border-t border-slate-800">
          <button
            onClick={onFakeOpen}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-4 py-2 rounded text-sm"
          >
            {copied ? "✓ Demo mode — patch copied" : "Create pull request"}
          </button>
        </div>
      </div>
    </div>
  );
}

function parseDiff(diff: string): { oldStr: string; newStr: string } {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) continue;
    if (line.startsWith("-")) oldLines.push(line.slice(1));
    else if (line.startsWith("+")) newLines.push(line.slice(1));
    else if (line.startsWith(" ")) {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    }
  }
  return { oldStr: oldLines.join("\n"), newStr: newLines.join("\n") };
}
