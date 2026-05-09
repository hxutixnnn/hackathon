import { describe, it, expect } from "vitest";
import { normalizePath } from "../path";

describe("normalizePath", () => {
  it("strips leading ./", () => {
    expect(normalizePath("./routes/login.ts")).toBe("routes/login.ts");
  });
  it("converts backslashes", () => {
    expect(normalizePath("routes\\login.ts")).toBe("routes/login.ts");
  });
  it("leaves clean paths alone", () => {
    expect(normalizePath("routes/login.ts")).toBe("routes/login.ts");
  });
  it("strips multiple leading ./", () => {
    expect(normalizePath("././x.ts")).toBe("x.ts");
  });
});
