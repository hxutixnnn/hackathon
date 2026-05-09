import { describe, it, expect, vi } from "vitest";
import { runExplainGenerator, OpenAIClient } from "./studio_generators";
import { FindingForPrompt } from "./studio_prompts";

const finding: FindingForPrompt = {
  angle: "xss",
  file: "src/web.ts",
  lineStart: 5,
  lineEnd: 7,
  severity: 8,
  title: "Reflected XSS in /search",
  description: "Query param echoed unescaped.",
  evidence: "res.send(`<h1>${req.query.q}</h1>`)",
};

function fakeClient(reply: string): OpenAIClient {
  return {
    complete: vi.fn().mockResolvedValue(reply),
  };
}

describe("runExplainGenerator", () => {
  it("returns parsed explainMarkdown on valid response", async () => {
    const client = fakeClient(JSON.stringify({ explainMarkdown: "Plain bug.\n\nAttack.\n\nImpact." }));
    const result = await runExplainGenerator(finding, "snippet", client);
    expect(result.explainMarkdown).toContain("Plain bug.");
  });

  it("falls back to raw text when JSON parse fails", async () => {
    const client = fakeClient("not json at all");
    const result = await runExplainGenerator(finding, "snippet", client);
    expect(result.explainMarkdown).toBe("not json at all");
  });

  it("propagates OpenAI errors", async () => {
    const client: OpenAIClient = {
      complete: vi.fn().mockRejectedValue(new Error("rate limit")),
    };
    await expect(runExplainGenerator(finding, "snippet", client)).rejects.toThrow("rate limit");
  });
});

import { runProveGenerator } from "./studio_generators";

describe("runProveGenerator", () => {
  it("returns proofKind+content from valid response", async () => {
    const client = fakeClient(
      JSON.stringify({ proofKind: "payload", proofContent: "' OR 1=1--" }),
    );
    const result = await runProveGenerator(finding, "snippet", client);
    expect(result.proofKind).toBe("payload");
    expect(result.proofContent).toBe("' OR 1=1--");
  });

  it("defaults proofKind to template's expected kind when missing", async () => {
    const sqliFinding = { ...finding, angle: "sql_injection" };
    const client = fakeClient(JSON.stringify({ proofContent: "' OR 1=1--" }));
    const result = await runProveGenerator(sqliFinding, "snippet", client);
    expect(result.proofKind).toBe("payload");
  });
});

import { runFixGenerator } from "./studio_generators";

describe("runFixGenerator", () => {
  const validDiff =
    "--- a/src/web.ts\n+++ b/src/web.ts\n@@ -5,1 +5,1 @@\n-res.send(`<h1>${req.query.q}</h1>`)\n+res.send(`<h1>${escapeHtml(req.query.q)}</h1>`)";

  it("returns parsed result on valid diff", async () => {
    const client = fakeClient(
      JSON.stringify({
        patchUnifiedDiff: validDiff,
        fixSummary: "Escape user input in /search",
        fixBody: "Apply escapeHtml.",
      }),
    );
    const result = await runFixGenerator(finding, "snippet", client);
    expect(result.patchUnifiedDiff).toContain("--- a/src/web.ts");
    expect(result.fixSummary).toBe("Escape user input in /search");
  });

  it("throws PatchMalformedError when diff missing required headers", async () => {
    const client = fakeClient(
      JSON.stringify({
        patchUnifiedDiff: "no headers here just text",
        fixSummary: "Bad",
        fixBody: "Bad",
      }),
    );
    await expect(runFixGenerator(finding, "snippet", client)).rejects.toThrow(/malformed/);
  });
});
