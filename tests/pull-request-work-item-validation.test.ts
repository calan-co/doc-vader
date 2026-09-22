import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const scriptPath = path.join(repoRoot, "scripts/validate-pull-request-work-items.ts");
const pullRequestUrl = "https://github.com/calan-co/doc-vader/pull/95";
let testDir = "";

function write(relativePath: string, content: string): void {
  const filePath = path.join(testDir, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

function run(changedPaths: string[]) {
  const result = spawnSync(process.execPath, ["--import", tsxImport, scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DOC_VADER_ROOT: testDir,
      DOC_VADER_PULL_REQUEST_URL: pullRequestUrl,
      DOC_VADER_CHANGED_PATHS: JSON.stringify(changedPaths),
    },
  });
  return { code: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

const completed = `---
id: wi-60498
type: work-item
status: completed
status_reason: completed
completed_date: '2026-09-21'
actual: 3
links:
  pull_requests:
    - ${pullRequestUrl}
  evidence:
    - '[[record-20260921-195524-60498]]'
---

## Tasks

- [x] Implement the change.

## Acceptance Criteria

- [x] The implementation is validated.
`;

beforeEach(() => {
  testDir = mkdtempSync(path.join(os.tmpdir(), "doc-vader-pr-work-item-test-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  testDir = "";
});

describe("pull-request work item validation script", () => {
  it("fails closed for an implementation change without an association", () => {
    const result = run(["lib/init/command.ts"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/require exactly one Work item linked/i);
  });

  it("accepts a completed linked Work item", () => {
    write("backlog/60498-init.md", completed);

    const result = run(["lib/init/command.ts"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/validation passed/i);
  });

  it("does not let an archived Work item satisfy an implementation association", () => {
    write("backlog/archive/60498-init.md", completed);

    const result = run(["lib/init/command.ts"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/require exactly one Work item linked/i);
  });
});
