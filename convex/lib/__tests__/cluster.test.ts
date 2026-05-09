import { describe, it, expect } from "vitest";
import { cosine, UnionFind, lineRangesOverlap } from "../cluster";

describe("cosine", () => {
  it("identical vectors → 1", () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it("orthogonal vectors → 0", () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it("negated vectors → -1", () => {
    expect(cosine([1, 2], [-1, -2])).toBeCloseTo(-1, 6);
  });

  it("zero vector → 0 (no NaN)", () => {
    expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe("UnionFind", () => {
  it("disjoint by default", () => {
    const uf = new UnionFind(3);
    expect(uf.find(0)).not.toBe(uf.find(1));
  });

  it("union merges", () => {
    const uf = new UnionFind(3);
    uf.union(0, 1);
    expect(uf.find(0)).toBe(uf.find(1));
    expect(uf.find(2)).not.toBe(uf.find(0));
  });

  it("union is transitive", () => {
    const uf = new UnionFind(4);
    uf.union(0, 1);
    uf.union(1, 2);
    expect(uf.find(0)).toBe(uf.find(2));
    expect(uf.find(3)).not.toBe(uf.find(0));
  });

  it("groups returns clusters as id arrays", () => {
    const uf = new UnionFind(5);
    uf.union(0, 1);
    uf.union(2, 3);
    const groups = uf.groups();
    expect(groups).toHaveLength(3);
    const sizes = groups.map((g) => g.length).sort();
    expect(sizes).toEqual([1, 2, 2]);
  });
});

describe("lineRangesOverlap", () => {
  it("touching ranges overlap (inclusive)", () => {
    expect(lineRangesOverlap(1, 5, 5, 10)).toBe(true);
  });

  it("contained range overlaps", () => {
    expect(lineRangesOverlap(1, 100, 50, 60)).toBe(true);
  });

  it("disjoint ranges do not overlap", () => {
    expect(lineRangesOverlap(1, 4, 6, 10)).toBe(false);
  });

  it("slack extends overlap window", () => {
    expect(lineRangesOverlap(1, 4, 8, 10, 5)).toBe(true);
    expect(lineRangesOverlap(1, 4, 8, 10, 2)).toBe(false);
  });

  it("identical single-line ranges overlap", () => {
    expect(lineRangesOverlap(7, 7, 7, 7)).toBe(true);
  });
});
