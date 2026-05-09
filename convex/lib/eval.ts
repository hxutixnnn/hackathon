import { normalizePath } from "./path";
import { lineRangesOverlap } from "./cluster";

export function corpusFor(repoUrl: string): string | null {
  if (/juice-shop/i.test(repoUrl)) return "juice-shop";
  return null;
}

export type TruthRow = {
  _id: string;
  file: string;
  lineStart: number;
  lineEnd: number;
};

export type FindingRow = {
  _id: string;
  file: string;
  lineStart: number;
  lineEnd: number;
};

export type ScoreResult = {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  matchedTruthIds: string[];
  matchedFindingIds: string[];
};

export function scoreScan(
  truth: TruthRow[],
  findings: FindingRow[],
): ScoreResult {
  const matchedTruth = new Set<string>();
  const matchedFinding = new Set<string>();

  for (const t of truth) {
    const tFile = normalizePath(t.file);
    for (const f of findings) {
      const fFile = normalizePath(f.file);
      if (
        fFile === tFile &&
        lineRangesOverlap(f.lineStart, f.lineEnd, t.lineStart, t.lineEnd)
      ) {
        matchedTruth.add(t._id);
        matchedFinding.add(f._id);
        break;
      }
    }
  }

  const tp = matchedTruth.size;
  const fn = truth.length - tp;
  const fp = findings.length - matchedFinding.size;

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0
    ? 0
    : (2 * precision * recall) / (precision + recall);

  return {
    tp,
    fp,
    fn,
    precision,
    recall,
    f1,
    matchedTruthIds: [...matchedTruth],
    matchedFindingIds: [...matchedFinding],
  };
}
