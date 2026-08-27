import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../.github/workflows/windows-node22-diagnostic.yml",
  ),
  "utf8",
);

describe("Windows Node 22 diagnostic workflow contract", () => {
  it("is a separate manual-only, read-only diagnostic surface", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(
      /^\s*(push|pull_request|schedule|workflow_call|repository_dispatch):/m,
    );
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("runs-on: windows-latest");
    expect(workflow).toContain("node-version: 22.23.2");
    expect(workflow).toContain("067dff5736754438e1bf8185096c26a9dacebfb1");
    expect(workflow).toContain("timeout-minutes: 360");
    expect(workflow).toContain("persist-credentials: false");
  });

  it("only accepts bounded diagnostic inputs and always retains evidence", () => {
    expect(workflow).toContain(
      "Bounded iterations for each probe phase (1-30)",
    );
    expect(workflow).toContain('default: "1"');
    expect(workflow).not.toContain("artifact_label:");
    expect(workflow).toContain("INPUT_ITERATIONS");
    expect(workflow).toContain("scripts/windows-node22-diagnostic-probe.mjs");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain("if-no-files-found: error");
    expect(workflow).not.toMatch(/\b(gh|git\s+push)\b/);
  });
});
