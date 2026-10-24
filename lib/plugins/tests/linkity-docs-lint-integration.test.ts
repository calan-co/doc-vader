import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

function docsLint(...args: string[]) {
  return execFileSync(
    "pnpm",
    ["exec", "tsx", "scripts/docs-remark-lint.ts", "--format", "json", ...args],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
}

describe("Linkity docs-lint integration fixtures", () => {
  it("accepts valid Linkity fixtures through the docs-lint entrypoint", () => {
    const output = docsLint("tests/fixtures/linkity-crossref/valid*.md", "tests/fixtures/linkity-crossref/encoded*.md");
    const payload = JSON.parse(output);

    expect(payload.passed).toBe(true);
    expect(payload.summary.errorCount).toBe(0);
  });

  it("reports broken targets and anchors through the docs-lint entrypoint", () => {
    let output = "";
    try {
      docsLint("--fail-on", "linkity", "tests/fixtures/linkity-crossref/invalid.md");
    } catch (err: any) {
      output = String(err.stdout);
    }

    const payload = JSON.parse(output);
    const messages = payload.results.flatMap((result: any) => result.messages.map((message: any) => message.message));
    expect(payload.passed).toBe(false);
    expect(messages).toContain("Linkity missing-target: ./missing.md");
    expect(messages).toContain("Linkity missing-anchor: ./valid-target.md#nope");
    expect(payload.summary.linkityBrokenCount).toBe(2);
  });
});
