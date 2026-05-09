"use node";
import { createHash } from "node:crypto";

export type ChunkFile = { path: string; content: string };

export function chunkHash(files: ChunkFile[]): string {
  const h = createHash("sha256");
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of sorted) {
    h.update(f.path);
    h.update("\0");
    h.update(f.content);
    h.update("\0");
  }
  return h.digest("hex");
}

export function cacheKey(
  angleId: string,
  files: ChunkFile[],
  model: string,
  promptVer: string,
): string {
  const h = createHash("sha256");
  h.update(angleId);
  h.update("|");
  h.update(model);
  h.update("|");
  h.update(promptVer);
  h.update("|");
  h.update(chunkHash(files));
  return h.digest("hex");
}
