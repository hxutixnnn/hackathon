// src/components/tabs/ProveTab.tsx
import { useState } from "react";

export default function ProveTab({
  finding: _finding,
  row,
}: {
  finding: unknown;
  row: {
    status: "pending" | "running" | "done" | "error";
    proofKind?: string;
    proofContent?: string;
    error?: string;
  } | null;
}) {
  if (row === null || row.status === "running" || row.status === "pending") {
    return <Skeleton />;
  }
  if (row.status === "error") {
    return (
      <div className="bg-red-950/50 border border-red-800 rounded p-3 text-sm">
        <div className="text-red-300 font-medium">Generation failed</div>
        <div className="text-red-400/80 text-xs mt-1 font-mono">{row.error}</div>
      </div>
    );
  }

  const kind = row.proofKind ?? "payload";
  const content = row.proofContent ?? "";

  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-wider text-slate-500">How to reproduce</div>
      {kind === "cve" ? (
        <CveBlock content={content} />
      ) : (
        <CodeBlock content={content} label={labelFor(kind)} />
      )}
    </div>
  );
}

function labelFor(kind: string): string {
  return (
    {
      payload: "payload",
      curl: "curl reproducer",
      hash: "sample hash + crack command",
      diagram: "diagram",
      interleaving: "thread interleaving",
      cve: "CVE",
    } as Record<string, string>
  )[kind] ?? kind;
}

function CodeBlock({ content, label }: { content: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-slate-900 border border-slate-800 rounded">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
        <div className="text-xs text-slate-500 uppercase tracking-wider">{label}</div>
        <button
          onClick={() => {
            navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="text-xs text-emerald-400 hover:text-emerald-300"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="text-xs p-3 overflow-x-auto whitespace-pre-wrap break-all">{content}</pre>
    </div>
  );
}

function CveBlock({ content }: { content: string }) {
  const cveMatch = content.match(/CVE-\d{4}-\d{4,7}/);
  const urlMatch = content.match(/https?:\/\/\S+/);
  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-3 space-y-2">
      {cveMatch && (
        <span className="inline-block bg-red-900/50 text-red-300 px-2 py-1 rounded text-xs font-mono">
          {cveMatch[0]}
        </span>
      )}
      {urlMatch && (
        <a
          href={urlMatch[0]}
          target="_blank"
          rel="noreferrer"
          className="block text-emerald-400 text-xs underline truncate"
        >
          {urlMatch[0]}
        </a>
      )}
      <div className="text-sm text-slate-300">{content}</div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-3 bg-slate-800 rounded w-1/3" />
      <div className="h-20 bg-slate-900 rounded" />
    </div>
  );
}
