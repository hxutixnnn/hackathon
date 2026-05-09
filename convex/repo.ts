"use node";

import { Octokit } from "@octokit/rest";
import * as tar from "tar";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const ALLOWED_EXTS = new Set([
  "js","ts","jsx","tsx","py","php","go","rb","java","rs","sh","html","vue","json","txt","toml",
]);
const MAX_FILES = 200;
const MAX_FILE_BYTES = 50_000;

export type RepoFile = { path: string; content: string };
export type DownloadResult = { files: RepoFile[]; sha?: string };

export function parseGithubUrl(url: string): { owner: string; repo: string } {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git|\/|$)/);
  if (!m) throw new Error("Invalid GitHub URL");
  return { owner: m[1], repo: m[2] };
}

export async function downloadRepo(repoUrl: string): Promise<DownloadResult> {
  const { owner, repo } = parseGithubUrl(repoUrl);
  const octokit = new Octokit();

  const res = await octokit.repos.downloadTarballArchive({ owner, repo, ref: "" });
  const buffer = Buffer.from(res.data as ArrayBuffer);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pbb-"));
  const tarPath = path.join(tmpDir, "repo.tar.gz");
  fs.writeFileSync(tarPath, buffer);
  await tar.x({ file: tarPath, cwd: tmpDir });

  const entries = fs.readdirSync(tmpDir).filter((f) => f !== "repo.tar.gz");
  const root = path.join(tmpDir, entries[0]);
  // GitHub tarball top-level dir is `<owner>-<repo>-<sha7>` or similar
  const shaMatch = entries[0].match(/-([a-f0-9]{7,40})$/);
  const sha = shaMatch?.[1];

  const files: RepoFile[] = [];
  walk(root, root, files);
  return { files, sha };

  function walk(dir: string, base: string, out: RepoFile[]) {
    if (out.length >= MAX_FILES) return;
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(".") || name === "node_modules" || name === "vendor") continue;
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full, base, out);
      } else if (stat.isFile()) {
        const ext = path.extname(name).slice(1).toLowerCase();
        if (!ALLOWED_EXTS.has(ext)) continue;
        if (stat.size > MAX_FILE_BYTES) continue;
        const content = fs.readFileSync(full, "utf8");
        out.push({ path: path.relative(base, full), content });
        if (out.length >= MAX_FILES) return;
      }
    }
  }
}

export function chunkFiles(
  files: RepoFile[],
  allowedExts: string[],
  chunkSizeBytes = 15_000,
): RepoFile[][] {
  const filtered = allowedExts.includes("*")
    ? files
    : files.filter((f) => {
        const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
        return allowedExts.includes(ext);
      });

  const chunks: RepoFile[][] = [];
  let current: RepoFile[] = [];
  let currentBytes = 0;
  for (const f of filtered) {
    const size = f.content.length;
    if (currentBytes + size > chunkSizeBytes && current.length > 0) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(f);
    currentBytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export async function fetchSnippet(
  repoUrl: string,
  sha: string,
  filePath: string,
  lineStart: number,
  lineEnd: number,
  padding = 10,
): Promise<string | null> {
  const { owner, repo } = parseGithubUrl(repoUrl);
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${filePath}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const text = await r.text();
  const lines = text.split("\n");
  const start = Math.max(0, lineStart - 1 - padding);
  const end = Math.min(lines.length, lineEnd + padding);
  return lines.slice(start, end).map((ln, i) => `${String(start + i + 1).padStart(4)}: ${ln}`).join("\n");
}
