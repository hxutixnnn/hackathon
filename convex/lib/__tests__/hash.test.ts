import { describe, it, expect } from "vitest";
import { cacheKey, chunkHash } from "../hash";

describe("cacheKey", () => {
  const files = [
    { path: "b.ts", content: "two" },
    { path: "a.ts", content: "one" },
  ];

  it("is stable regardless of file order", () => {
    const k1 = cacheKey("xss", files, "gpt-4o-mini", "v1");
    const k2 = cacheKey("xss", [...files].reverse(), "gpt-4o-mini", "v1");
    expect(k1).toBe(k2);
  });

  it("changes when file content changes", () => {
    const k1 = cacheKey("xss", files, "gpt-4o-mini", "v1");
    const k2 = cacheKey(
      "xss",
      [{ path: "a.ts", content: "ONE" }, { path: "b.ts", content: "two" }],
      "gpt-4o-mini",
      "v1",
    );
    expect(k1).not.toBe(k2);
  });

  it("changes when angleId changes", () => {
    const k1 = cacheKey("xss", files, "gpt-4o-mini", "v1");
    const k2 = cacheKey("sqli", files, "gpt-4o-mini", "v1");
    expect(k1).not.toBe(k2);
  });

  it("changes when promptVer changes", () => {
    const k1 = cacheKey("xss", files, "gpt-4o-mini", "v1");
    const k2 = cacheKey("xss", files, "gpt-4o-mini", "v2");
    expect(k1).not.toBe(k2);
  });

  it("returns 64-char hex (sha256)", () => {
    const k = cacheKey("xss", files, "gpt-4o-mini", "v1");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles empty files array", () => {
    const k = cacheKey("xss", [], "gpt-4o-mini", "v1");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("chunkHash", () => {
  it("is stable regardless of file order", () => {
    const a = [
      { path: "x.ts", content: "x" },
      { path: "y.ts", content: "y" },
    ];
    expect(chunkHash(a)).toBe(chunkHash([...a].reverse()));
  });

  it("differs from cacheKey", () => {
    const files = [{ path: "a.ts", content: "one" }];
    expect(chunkHash(files)).not.toBe(
      cacheKey("xss", files, "gpt-4o-mini", "v1"),
    );
  });
});
