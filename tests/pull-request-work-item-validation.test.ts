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
const scriptPath = path.join(
  repoRoot,
  "scripts/validate-pull-request-work-items.ts",
);
const pullRequestUrl = "https://github.com/calan-co/doc-vader/pull/95";
let testDir = "";

function write(relativePath: string, content: string): void {
  const filePath = path.join(testDir, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

function run(changedPaths: string[]) {
  return runWithEnvironment({
    DOC_VADER_CHANGED_PATHS: JSON.stringify(changedPaths),
  });
}

function git(args: string[]): string {
  const result = spawnSync("git", args, { cwd: testDir, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function runWithEnvironment(environment: Record<string, string>) {
  const result = spawnSync(
    process.execPath,
    ["--import", tsxImport, scriptPath],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        DOC_VADER_ROOT: testDir,
        DOC_VADER_PULL_REQUEST_URL: pullRequestUrl,
        ...environment,
      },
    },
  );
  return {
    code: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

const completed = `---
id: wi-60498
type: work-item
lifecycle: active
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

  it("does not let a record satisfy an implementation association", () => {
    write("backlog/records/60498-record.md", completed);

    const result = run(["lib/init/command.ts"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/require exactly one Work item linked/i);
  });

  it("accepts changed paths supplied in a JSON file", () => {
    write("backlog/60498-init.md", completed);
    write("changed-paths.json", JSON.stringify(["lib/init/command.ts"]));

    const result = runWithEnvironment({
      DOC_VADER_CHANGED_PATHS_FILE: path.join(testDir, "changed-paths.json"),
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/validation passed/i);
  });

  it("treats an implementation-to-documentation rename as an implementation change", () => {
    write("lib/foo.ts", "export {};\n");
    mkdirSync(path.join(testDir, "docs"));
    git(["init"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test User"]);
    git(["add", "."]);
    git(["commit", "-m", "initial"]);
    const base = git(["rev-parse", "HEAD"]);

    git(["mv", "lib/foo.ts", "docs/foo.ts"]);
    git(["commit", "-m", "move source to docs"]);
    const head = git(["rev-parse", "HEAD"]);

    const result = runWithEnvironment({
      DOC_VADER_BASE_SHA: base,
      DOC_VADER_HEAD_SHA: head,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/require exactly one Work item linked/i);
  });
});
