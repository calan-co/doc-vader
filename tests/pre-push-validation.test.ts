import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const scriptPath = path.join(repoRoot, "scripts/validate-work-items-pre-push.ts");
const workManagementSchemaPath = path.join(
  repoRoot,
  "schemas/work-management/frontmatter/work-item.json",
);

let testDir = "";

function run(command: string, args: string[], cwd: string, env?: Record<string, string>) {
  const shouldUseShell = process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: shouldUseShell,
    env: {
      ...process.env,
      ...(env ?? {}),
    },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function git(args: string[], cwd: string) {
  const result = run("git", args, cwd);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

function write(relativePath: string, content: string) {
  const filePath = path.join(testDir, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

function setupRepo() {
  git(["init", "-b", "staging"], testDir);
  git(["config", "user.email", "test@example.com"], testDir);
  git(["config", "user.name", "Test User"], testDir);

  write("README.md", "# temp\n");
  git(["add", "README.md"], testDir);
  git(["commit", "-m", "init"], testDir);

  git(["checkout", "-b", "feature/prepush-validation"], testDir);
  git(["branch", "--set-upstream-to=staging", "feature/prepush-validation"], testDir);
}

function writeConsumerConfig(config: Record<string, unknown>) {
  write(".doc-vader/backlog-consumer.json", JSON.stringify(config, null, 2));
}

function commitWorkItem(relativePath: string, frontmatterBody: string) {
  write(relativePath, frontmatterBody);
  git(["add", relativePath], testDir);
  git(["commit", "-m", `add ${relativePath}`], testDir);
}

function runValidator(env?: Record<string, string>) {
  return run(process.execPath, ["--import", tsxImport, scriptPath], testDir, {
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    ...env,
  });
}

beforeEach(() => {
  testDir = mkdtempSync(path.join(os.tmpdir(), "doc-vader-prepush-test-"));
  setupRepo();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  testDir = "";
});

describe("pre-push validation integration", () => {
  it("accepts an aborted work item with a cancelled reason", () => {
    writeConsumerConfig({
      automation: {
        prePushValidation: {
          schemas: {
            baseline: workManagementSchemaPath,
            changed: workManagementSchemaPath,
            archive: workManagementSchemaPath,
          },
          severity: {
            baseline: "none",
            changed: "error",
            archive: "none",
            checklist: "error",
          },
        },
      },
    });

    commitWorkItem(
      "backlog/300.cancelled.md",
      `---
id: wi-300
title: Cancelled
summary: Retire an unstarted work item.
type: work-item
subtype: task
lifecycle: active
status: aborted
status_reason: cancelled
priority: medium
links:
  reference:
    - '[[record-cancelled]]'
---\n`,
    );

    const result = runValidator();
    expect(result.code, result.stderr).toBe(0);
  });

  it("fails with changed-schema severity=error", { timeout: 15000 }, () => {
    writeConsumerConfig({
      automation: {
        prePushValidation: {
          schemas: {
            baseline: workManagementSchemaPath,
            changed: workManagementSchemaPath,
            archive: workManagementSchemaPath,
          },
          severity: {
            baseline: "none",
            changed: "error",
            archive: "warn",
            checklist: "none",
          },
        },
      },
    });

    commitWorkItem(
      "backlog/300.test-integration.md",
      `---
id: wi-300
status: ready-for-review
type: work-item
---\n\n## Tasks\n\n- [x] done\n\n## Acceptance Criteria\n\n- [x] done\n`,
    );

    const result = runValidator();
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/validation failed/i);
    expect(result.stderr).toMatch(/schema .*work-item\.json/i);
  });

  it("blocks ready-for-review items whose dependencies are not closed", () => {
    writeConsumerConfig({
      automation: {
        prePushValidation: {
          schemas: {
            baseline: workManagementSchemaPath,
            changed: workManagementSchemaPath,
            archive: workManagementSchemaPath,
          },
          severity: {
            baseline: "none",
            changed: "error",
            archive: "warn",
            checklist: "error",
          },
        },
      },
    });

    commitWorkItem(
      "backlog/101.foundation.md",
      `---
id: wi-101
status: in-progress
type: work-item
subtype: task
lifecycle: active
priority: medium
estimated: 2
---

## Goal

- Establish the foundation.
`,
    );

    commitWorkItem(
      "backlog/102.dependent.md",
      `---
id: wi-102
status: ready-for-review
type: work-item
subtype: task
lifecycle: active
priority: medium
estimated: 2
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/102
  depends_on:
    - '[[101.foundation]]'
---

## Goal

- Complete the dependent work.

## Tasks

- [x] Implement the change.

## Acceptance Criteria

- [x] The work is ready to review.
`,
    );

    const result = runValidator();

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/dependency .*must be closed before entering 'ready-for-review'/i);
  });

  it("passes with changed-schema severity=info", () => {
    writeConsumerConfig({
      automation: {
        prePushValidation: {
          schemas: {
            baseline: workManagementSchemaPath,
            changed: workManagementSchemaPath,
            archive: workManagementSchemaPath,
          },
          severity: {
            baseline: "none",
            changed: "info",
            archive: "warn",
            checklist: "none",
          },
        },
      },
    });

    commitWorkItem(
      "backlog/301.test-integration.md",
      `---
id: wi-301
status: ready-for-review
type: work-item
---\n\n## Tasks\n\n- [x] done\n\n## Acceptance Criteria\n\n- [x] done\n`,
    );

    const result = runValidator();
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/pre-push\(work-item\): info/i);
    expect(result.stdout).toMatch(/validation passed/i);
  });

  it("warns only for archive violations when archive severity=warn", () => {
    writeConsumerConfig({
      automation: {
        prePushValidation: {
          schemas: {
            baseline: workManagementSchemaPath,
            changed: workManagementSchemaPath,
            archive: workManagementSchemaPath,
          },
          severity: {
            baseline: "none",
            changed: "none",
            archive: "warn",
            checklist: "warn",
          },
        },
      },
    });

    commitWorkItem(
      "backlog/archive/302.test-integration.md",
      `---
id: wi-302
status: closed
type: work-item
---\n\n## Tasks\n\n- [ ] pending\n\n## Acceptance Criteria\n\n- [ ] pending\n`,
    );

    const result = runValidator();
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/warnings/i);
  });

  it("blocks completed items with unchecked delivery criteria", () => {
    writeConsumerConfig({
      automation: {
        prePushValidation: {
          schemas: {
            baseline: workManagementSchemaPath,
            changed: workManagementSchemaPath,
            archive: workManagementSchemaPath,
          },
          severity: {
            baseline: "none",
            changed: "none",
            archive: "warn",
            checklist: "error",
          },
        },
      },
    });

    commitWorkItem(
      "backlog/305.completed-with-unchecked-criteria.md",
      `---
id: wi-305
status: completed
type: work-item
---\n\n## Tasks\n\n- [ ] pending\n\n## Acceptance Criteria\n\n- [x] done\n`,
    );

    const result = runValidator();

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/section '## Tasks' has 1 unchecked checklist item/i);
  });

  it("accepts ordered completed checklists", () => {
    writeConsumerConfig({
      automation: {
        prePushValidation: {
          schemas: {
            baseline: workManagementSchemaPath,
            changed: workManagementSchemaPath,
            archive: workManagementSchemaPath,
          },
          severity: {
            baseline: "none",
            changed: "none",
            archive: "warn",
            checklist: "error",
          },
        },
      },
    });

    commitWorkItem(
      "backlog/306.completed-ordered-checklist.md",
      `---
id: wi-306
status: completed
type: work-item
---\n\n## Tasks\n\n1. [x] done\n\n## Acceptance Criteria\n\n1. [x] done\n`,
    );

    expect(runValidator().code).toBe(0);
  });

  it("honors DOC_VADER_PREPUSH_SEVERITY_ARCHIVE over config", () => {
    writeConsumerConfig({
      automation: {
        prePushValidation: {
          schemas: {
            baseline: workManagementSchemaPath,
            changed: workManagementSchemaPath,
            archive: workManagementSchemaPath,
          },
          severity: {
            baseline: "none",
            changed: "none",
            archive: "warn",
            checklist: "none",
          },
        },
      },
    });

    commitWorkItem(
      "backlog/archive/304.test-integration.md",
      `---
id: wi-304
status: ready-for-review
type: work-item
---\n\n## Tasks\n\n- [x] done\n\n## Acceptance Criteria\n\n- [x] done\n`,
    );

    const result = runValidator({
      DOC_VADER_PREPUSH_SEVERITY_ARCHIVE: "error",
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/validation failed/i);
  });
});

describe("pre-push validation e2e", () => {
  it("fails when invoked through pre-push hook entrypoint", () => {
    writeConsumerConfig({
      automation: {
        prePushValidation: {
          schemas: {
            baseline: workManagementSchemaPath,
            changed: workManagementSchemaPath,
            archive: workManagementSchemaPath,
          },
          severity: {
            baseline: "none",
            changed: "error",
            archive: "warn",
            checklist: "none",
          },
        },
      },
    });

    commitWorkItem(
      "backlog/303.test-e2e.md",
      `---
id: wi-303
status: ready-for-review
type: work-item
---\n\n## Tasks\n\n- [x] done\n\n## Acceptance Criteria\n\n- [x] done\n`,
    );

    write(
      ".husky/pre-push",
      `#!/usr/bin/env sh\n\nTMPDIR="\${TMPDIR:-/tmp}" "${process.execPath}" --import "${tsxImport}" "${scriptPath}"\n`,
    );
    chmodSync(path.join(testDir, ".husky/pre-push"), 0o755);

    const result = run("sh", [path.join(testDir, ".husky/pre-push")], testDir);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/validation failed/i);
  });
});
