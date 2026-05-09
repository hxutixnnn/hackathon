import { describe, it, expect } from "vitest";
import { corpusFor, scoreScan } from "../eval";

describe("corpusFor", () => {
  it("matches juice-shop variants", () => {
    expect(corpusFor("https://github.com/juice-shop/juice-shop")).toBe("juice-shop");
    expect(corpusFor("git@github.com:juice-shop/juice-shop.git")).toBe("juice-shop");
    expect(corpusFor("https://github.com/JUICE-SHOP/juice-shop")).toBe("juice-shop");
  });
  it("returns null for unknown repos", () => {
    expect(corpusFor("https://github.com/torvalds/linux")).toBeNull();
  });
});

describe("scoreScan", () => {
  type Truth = { _id: string; file: string; lineStart: number; lineEnd: number };
  type Finding = { _id: string; file: string; lineStart: number; lineEnd: number };

  const truth: Truth[] = [
    { _id: "t1", file: "routes/login.ts", lineStart: 10, lineEnd: 20 },
    { _id: "t2", file: "routes/login.ts", lineStart: 50, lineEnd: 60 },
    { _id: "t3", file: "routes/cart.ts", lineStart: 5, lineEnd: 8 },
  ];

  it("perfect hit on every truth → recall=1", () => {
    const findings: Finding[] = [
      { _id: "f1", file: "routes/login.ts", lineStart: 12, lineEnd: 18 },
      { _id: "f2", file: "routes/login.ts", lineStart: 55, lineEnd: 56 },
      { _id: "f3", file: "routes/cart.ts", lineStart: 5, lineEnd: 5 },
    ];
    const r = scoreScan(truth, findings);
    expect(r.tp).toBe(3);
    expect(r.fn).toBe(0);
    expect(r.fp).toBe(0);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(1);
    expect(r.f1).toBe(1);
  });

  it("extra finding counts as FP", () => {
    const findings: Finding[] = [
      { _id: "f1", file: "routes/login.ts", lineStart: 12, lineEnd: 18 },
      { _id: "f2", file: "routes/other.ts", lineStart: 1, lineEnd: 2 },
    ];
    const r = scoreScan(truth, findings);
    expect(r.tp).toBe(1);
    expect(r.fp).toBe(1);
    expect(r.fn).toBe(2);
  });

  it("normalizes paths before compare", () => {
    const findings: Finding[] = [
      { _id: "f1", file: "./routes/login.ts", lineStart: 10, lineEnd: 11 },
    ];
    const r = scoreScan(truth, findings);
    expect(r.tp).toBe(1);
  });

  it("zero division safe — no truth, no findings → all zero", () => {
    const r = scoreScan([], []);
    expect(r.precision).toBe(0);
    expect(r.recall).toBe(0);
    expect(r.f1).toBe(0);
  });

  it("matchedFindingIds + matchedTruthIds populated", () => {
    const findings: Finding[] = [
      { _id: "f1", file: "routes/login.ts", lineStart: 12, lineEnd: 18 },
    ];
    const r = scoreScan(truth, findings);
    expect(r.matchedFindingIds).toEqual(["f1"]);
    expect(r.matchedTruthIds).toEqual(["t1"]);
  });
});
