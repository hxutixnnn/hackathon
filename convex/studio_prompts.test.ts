import { describe, it, expect } from "vitest";
import { ANGLES } from "./prompts";
import {
  PROVE_TEMPLATES,
  buildExplainPrompt,
  buildProvePrompt,
  buildFixPrompt,
  FindingForPrompt,
} from "./studio_prompts";

const sampleFinding: FindingForPrompt = {
  angle: "sql_injection",
  file: "src/db.ts",
  lineStart: 10,
  lineEnd: 12,
  severity: 9,
  title: "SQL injection in user lookup",
  description: "User input is concatenated into a SQL query.",
  evidence: "db.query(`SELECT * FROM users WHERE id = ${userId}`)",
};

describe("studio prompts", () => {
  it("has a prove template for every angle", () => {
    for (const angle of ANGLES) {
      expect(PROVE_TEMPLATES[angle.id], `missing prove template for ${angle.id}`).toBeDefined();
    }
  });

  it("buildExplainPrompt includes the file path and snippet", () => {
    const prompt = buildExplainPrompt(sampleFinding, "snippet here");
    expect(prompt).toContain("src/db.ts");
    expect(prompt).toContain("snippet here");
    expect(prompt).toContain("explainMarkdown");
  });

  it("buildProvePrompt embeds the angle-specific instructions", () => {
    const prompt = buildProvePrompt(sampleFinding, "snippet here");
    expect(prompt).toContain("payload");
    expect(prompt).toContain("snippet here");
  });

  it("buildProvePrompt throws for unknown angle", () => {
    expect(() => buildProvePrompt({ ...sampleFinding, angle: "made_up" }, "x")).toThrow();
  });

  it("buildFixPrompt produces a unified-diff instruction", () => {
    const prompt = buildFixPrompt(sampleFinding, "snippet here");
    expect(prompt).toContain("unified diff");
    expect(prompt).toContain("--- a/");
    expect(prompt).toContain("+++ b/");
  });
});
