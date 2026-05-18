import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(__dirname, "..");
const cliPath = path.join(repoRoot, "cli", "doc-vader.ts");

let testDir = "";

function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  const tsxPackageJsonPath = require.resolve("tsx/package.json");
  const tsxCliPath = path.join(path.dirname(tsxPackageJsonPath), "dist", "cli.mjs");
  const result = spawnSync(
    process.execPath,
    [tsxCliPath, cliPath, ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: process.env,
    },
  );

  return {
    code: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

afterEach(() => {
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true });
    testDir = "";
  }
});

describe("backlog scan e2e", () => {
  it("honors consumer-config matching patterns, pull request path, and required candidate fields", () => {
    testDir = mkdtempSync(path.join(os.tmpdir(), "doc-vader-scan-e2e-"));
    mkdirSync(path.join(testDir, "backlog"), { recursive: true });
    mkdirSync(path.join(testDir, ".doc-vader"), { recursive: true });

    writeFileSync(
      path.join(testDir, ".doc-vader", "backlog-consumer.json"),
      JSON.stringify(
        {
          roots: {
            backlog: "backlog",
            active: "backlog",
            archive: "backlog/archive",
            records: "backlog/records",
            audit: "backlog/audit",
          },
          automation: {
            subjectResolutionOrder: ["linked_pull_requests"],
            validateArchiveCandidates: true,
            workItemMatchPatterns: ["wi-"],
            pullRequestPath: "links.prs",
            requiredCandidateFields: [
              "actual",
              { field: "status", values: ["closed"] },
            ],
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    writeFileSync(
      path.join(testDir, "backlog", "1.custom-config.md"),
      `---
id: wi-1
type: work-item
status: ready-for-review
lifecycle: active
actual: 2
links:
  prs:
    - https://github.com/calan-co/doc-vader/pull/1
  evidence:
    - '[[record-20260101-000000-wi-1]]'
---

Tracks wi-1 for config-driven scan.
`,
      "utf8",
    );

    const result = runCli([
      "backlog",
      "scan",
      "--dir",
      path.join(testDir, "backlog"),
      "--consumer-config",
      path.join(testDir, ".doc-vader", "backlog-consumer.json"),
      "--report-format",
      "json",
    ]);

    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as {
      items: Array<{
        id: string;
        subjectResolution?: { subjects: string[] };
        candidateValidation?: { eligible: boolean; discrepancies: string[] };
      }>;
    };

    const item = report.items.find((entry) => entry.id === "wi-1");
    expect(item).toBeDefined();
    expect(item?.subjectResolution?.subjects).toEqual(["wi-1"]);
    expect(item?.candidateValidation?.eligible).toBe(false);
    expect(
      item?.candidateValidation?.discrepancies.some((message) =>
        message.includes("must be one of: closed"),
      ),
    ).toBe(true);
  });
});
