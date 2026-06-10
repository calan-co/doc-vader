import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const repoRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(repoRoot, "scripts/validate-work-items-pre-push.ts");
const tsxPath =
  process.platform === "win32"
    ? path.join(repoRoot, "node_modules/.bin/tsx.cmd")
    : path.join(repoRoot, "node_modules/.bin/tsx");
const latestSchemaPath = path.join(repoRoot, "schemas/frontmatter/work-item/latest.json");

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
  return run(tsxPath, [scriptPath], testDir, env);
}

beforeEach(() => {
  testDir = mkdtempSync(path.join(os.tmpdir(), "doc-vader-prepush-test-"));
  setupRepo();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  testDir = "";
});

describe("pre-push validation unit", () => {
  it("latest schema requires pull_requests for ready-for-review", () => {
    const schema = JSON.parse(readFileSync(latestSchemaPath, "utf8")) as Record<string, unknown>;
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const ok = validate({
      type: "work-item",
      status: "ready-for-review",
      links: {},
    });

    expect(ok).toBe(false);
    const requiredPullRequestsError = (validate.errors ?? []).some((error) => {
      return error.instancePath === "/links" && error.keyword === "required";
    });
    expect(requiredPullRequestsError).toBe(true);
  });
});

describe("pre-push validation integration", () => {
  it("fails with changed-schema severity=error", { timeout: 15000 }, () => {
    writeConsumerConfig({
      automation: {
        prePushValidation: {
          schemas: {
            baseline: latestSchemaPath,
            changed: latestSchemaPath,
            archive: latestSchemaPath,
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
    expect(result.stderr).toMatch(/schema .*latest\.json/i);
  });

  it("passes with changed-schema severity=info", () => {
    writeConsumerConfig({
      automation: {
        prePushValidation: {
          schemas: {
            baseline: latestSchemaPath,
            changed: latestSchemaPath,
            archive: latestSchemaPath,
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
            baseline: latestSchemaPath,
            changed: latestSchemaPath,
            archive: latestSchemaPath,
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

  it("honors DOC_VADER_PREPUSH_SEVERITY_ARCHIVE over config", () => {
    writeConsumerConfig({
      automation: {
        prePushValidation: {
          schemas: {
            baseline: latestSchemaPath,
            changed: latestSchemaPath,
            archive: latestSchemaPath,
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
            baseline: latestSchemaPath,
            changed: latestSchemaPath,
            archive: latestSchemaPath,
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
      `#!/usr/bin/env sh\n\n\"${tsxPath}\" \"${scriptPath}\"\n`,
    );
    chmodSync(path.join(testDir, ".husky/pre-push"), 0o755);

    const result = run("sh", [path.join(testDir, ".husky/pre-push")], testDir);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/validation failed/i);
  });
});
