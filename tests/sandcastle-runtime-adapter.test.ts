import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  openRuntimeSqliteStore,
  RUNTIME_SCHEMA_VERSION,
} from "../lib/runtime/sqlite-store.js";
import type { TaskShowModel } from "../lib/task/show.js";
import { writeBacklogConsumerConfig } from "./helpers/backlog-consumer-config.js";
import { stageWorkGraphUacFixture } from "./helpers/work-graph-uac-fixture.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const adapterPath = path.resolve(
  __dirname,
  "../scripts/sandcastle/dv4sandcastle.ts",
);
const cliPath = path.resolve(__dirname, "../cli/doc-vader.ts");
const inspectionTemplateNames = [
  "show.md.tpl",
  "sandcastle-prompt.md.tpl",
] as const;

const tempDirs: string[] = [];

async function measureStage<T>(
  name: string,
  operation: () => T | Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    if (process.env.DOC_VADER_STAGE_TIMING === "1") {
      console.info(
        `[sandcastle-stage] ${name}: ${(performance.now() - startedAt).toFixed(1)}ms`,
      );
    }
  }
}

type RuntimeClaimCommandResult = { outcome: string; claimToken: string };
type RuntimeLockCreateResult = { outcome: string };
type RuntimeLockStatusResult = {
  claimToken: string;
  state: string;
  locks: Array<{ path: string; state: string }>;
};
type RuntimeReleaseResult = {
  claimToken: string;
  executionLogEntry: { state: string; reason: string };
  locksRemoved: number;
};
type RuntimeRecoverResult = {
  taskId: string;
  executionLogEntry: { state: string; reason: string };
  transition: {
    frontmatter: {
      status: string;
      status_reason: string;
    };
  };
};
type SandcastleCloseResult = {
  taskId: string;
  claimToken: string;
  lockPaths: string[];
  record?: {
    taskId: string;
    evidenceLink: string;
    record: {
      id: string;
      filePath: string;
    };
  };
  transitionScript?: {
    path: string;
    lockPaths: string[];
  };
  validation: {
    claimId: string;
    taskId: string;
    dryRun: boolean;
  };
  release: {
    claimId: string;
    taskId: string;
    transition: {
      workItem: {
        frontmatter: {
          status: string;
          status_reason: string;
        };
      };
    };
    execution: {
      executionLogEntry: {
        state: string;
        reason: string;
      };
    };
  };
};

async function createTempRepo(): Promise<string> {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), `doc-vader-sandcastle-runtime-${randomUUID()}-`),
  );
  tempDirs.push(rootDir);
  await mkdir(path.join(rootDir, "backlog"), { recursive: true });
  writeBacklogConsumerConfig(rootDir);
  return rootDir;
}

function runGit(rootDir: string, args: string[]): void {
  execFileSync("git", args, {
    cwd: rootDir,
    stdio: "ignore",
  });
}

async function initGitRepo(rootDir: string): Promise<void> {
  runGit(rootDir, ["init", "--initial-branch", "main"]);
  runGit(rootDir, ["config", "user.email", "agent@example.com"]);
  runGit(rootDir, ["config", "user.name", "Agent"]);
  await writeFile(
    path.join(rootDir, ".gitignore"),
    ".doc-vader/runtime/\n",
    "utf8",
  );
}

async function writeTask(
  rootDir: string,
  fileName: string,
  frontmatter: string,
  body = "## Goal\n\nExercise Sandcastle runtime adapter behavior.\n",
): Promise<void> {
  await writeFile(
    path.join(rootDir, "backlog", fileName),
    `---\n${frontmatter.trim()}\n---\n\n${body}`,
    "utf8",
  );
}

async function stageInspectionTemplates(rootDir: string): Promise<void> {
  const templateDir = path.join(rootDir, "templates", "reference", "task");
  await mkdir(templateDir, { recursive: true });
  for (const templateName of inspectionTemplateNames) {
    await copyFile(
      path.resolve(__dirname, "../templates/reference/task", templateName),
      path.join(templateDir, templateName),
    );
  }
}

async function writeCloseScript(
  rootDir: string,
  relativePath: string,
  source: string,
): Promise<void> {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, source, "utf8");
}

function runTsScript(
  rootDir: string,
  scriptPath: string,
  args: string[],
  input?: string,
): string {
  return execFileSync(
    process.execPath,
    ["--import", tsxImport, scriptPath, ...args],
    {
      cwd: rootDir,
      encoding: "utf8",
      ...(input === undefined ? {} : { input }),
      env: {
        ...process.env,
        CI: "true",
      },
    },
  );
}

function runAdapter(rootDir: string, args: string[], input?: string): string {
  return runTsScript(rootDir, adapterPath, args, input);
}

function runCli(rootDir: string, args: string[]): string {
  return runTsScript(rootDir, cliPath, args);
}

function runAdapterJson<T>(rootDir: string, args: string[], input?: string): T {
  return JSON.parse(runAdapter(rootDir, args, input)) as T;
}

function runCliJson<T>(rootDir: string, args: string[]): T {
  return JSON.parse(runCli(rootDir, args)) as T;
}

function commitRepoState(rootDir: string, message: string): void {
  runGit(rootDir, ["add", "."]);
  runGit(rootDir, ["commit", "-m", message]);
}

function withRuntimeStore<T>(
  rootDir: string,
  callback: (store: ReturnType<typeof openRuntimeSqliteStore>) => T,
): T {
  const store = openRuntimeSqliteStore({ rootDir });
  try {
    return callback(store);
  } finally {
    store.close();
  }
}

function createExpiredRuntimeTaskClaim(
  rootDir: string,
  taskId: string,
): string {
  return withRuntimeStore(rootDir, (store) => {
    const createdAt = new Date(Date.now() - 120_000);
    const acquisition = store.acquireRuntimeClaim(
      {
        schema_version: RUNTIME_SCHEMA_VERSION,
        target_type: "task",
        target_id: taskId,
        holder: "sandcastle:agent-a",
        created_at: createdAt.toISOString(),
        expires_at: new Date(createdAt.getTime() + 60_000).toISOString(),
        entropy: randomUUID(),
      },
      { initialLockPaths: [] },
    );
    if (acquisition.outcome !== "acquired") {
      throw new Error(
        `Expected expired runtime claim acquisition for ${taskId}.`,
      );
    }
    return acquisition.claimToken;
  });
}

function runAdapterFailure(
  rootDir: string,
  args: string[],
  input?: string,
): string {
  try {
    runAdapter(rootDir, args, input);
  } catch (error) {
    const captured = error as { stdout?: unknown; stderr?: unknown };
    return [String(captured.stdout ?? ""), String(captured.stderr ?? "")]
      .join("\n")
      .trim();
  }
  throw new Error("Expected adapter command to fail.");
}

function parseStructuredDiagnostic(output: string): {
  error: { code: string; message: string };
} {
  for (
    let start = output.indexOf("{");
    start >= 0;
    start = output.indexOf("{", start + 1)
  ) {
    const end = jsonObjectEnd(output, start);
    if (end === undefined) {
      continue;
    }
    try {
      const diagnostic = JSON.parse(output.slice(start, end)) as {
        error?: { code?: unknown; message?: unknown };
      };
      if (
        typeof diagnostic.error?.code === "string" &&
        typeof diagnostic.error.message === "string"
      ) {
        return { error: diagnostic.error as { code: string; message: string } };
      }
    } catch {
      // The command runner may include non-JSON braces before the diagnostic.
    }
  }
  throw new Error(`Expected structured JSON diagnostic, received: ${output}`);
}

function jsonObjectEnd(value: string, start: number): number | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return undefined;
}

function inspectCompletedChecks(rootDir: string, taskId: string): void {
  const inspection = runCliJson<{
    checklist: { checks: Array<{ status: string }> };
  }>(rootDir, ["work", taskId, "checklist", "tasks", "--json"]);
  expect(inspection.checklist.checks).not.toHaveLength(0);
  expect(inspection.checklist.checks.every((check) => check.status === "met")).toBe(true);
}

async function createCommittedTaskRepo(
  rootDir: string,
  fileName: string,
  frontmatter: string,
  body?: string,
): Promise<void> {
  await initGitRepo(rootDir);
  await writeTask(rootDir, fileName, frontmatter, body);
  commitRepoState(rootDir, "chore: base");
}

async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function snapshotFileHashes(
  rootDir: string,
): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      const relativePath = path.relative(rootDir, entryPath);
      snapshot.set(relativePath, await hashFile(entryPath));
    }
  }

  await walk(rootDir);
  return snapshot;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0, tempDirs.length)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("dv4sandcastle runtime smoke", () => {
  it("parses compact structured diagnostics before command-runner text", () => {
    expect(
      parseStructuredDiagnostic(
        [
          "adapter context",
          '{"ok":false,"error":{"code":"TASK_COMMAND_FAILED","message":"Gate blocked"}}',
          "Command failed: dv4sandcastle close-task 211",
        ].join("\n"),
      ),
    ).toEqual({
      error: { code: "TASK_COMMAND_FAILED", message: "Gate blocked" },
    });
  });

  it("claims through runtime authority and ignores legacy JSON claim-store state", async () => {
    const rootDir = await createTempRepo();
    await createCommittedTaskRepo(
      rootDir,
      "200-runtime-claim.md",
      `id: wi-200
title: Runtime Claim
summary: Claim through runtime authority.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
tags:
  - afk`,
    );

    const legacyClaimStorePath = path.join(
      rootDir,
      ".doc-vader",
      "runtime",
      "task-claims",
    );
    const legacyClaimStore = `${JSON.stringify(
      {
        claims: [
          {
            id: "legacy-claim-200",
            taskId: "wi-200",
            holder: "sandcastle:agent-a",
            branch: "sandcastle/issue-200",
            createdAt: "2026-06-30T12:00:00.000Z",
            updatedAt: "2026-06-30T12:00:00.000Z",
            expiresAt: "2099-06-30T16:00:00.000Z",
          },
        ],
      },
      null,
      2,
    )}\n`;
    await mkdir(path.dirname(legacyClaimStorePath), { recursive: true });
    await writeFile(legacyClaimStorePath, legacyClaimStore, "utf8");

    const claimed = runAdapterJson<RuntimeClaimCommandResult>(rootDir, [
      "claim-task",
      "200",
      "--holder",
      "sandcastle:agent-a",
      "--branch",
      "sandcastle/issue-200",
      "--json",
    ]);

    expect(claimed).toMatchObject({
      outcome: "acquired",
      claimToken: expect.any(String),
    });

    withRuntimeStore(rootDir, (store) => {
      expect(store.listClaims()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            claim_token: claimed.claimToken,
            target_type: "task",
            target_id: "wi-200",
            holder: "sandcastle:agent-a",
          }),
        ]),
      );
    });

    expect(await readFile(legacyClaimStorePath, "utf8")).toBe(legacyClaimStore);
  }, 30_000);

  it("shares runtime claim authority across Git worktrees through public claim and work surfaces", async () => {
    const rootDir = await createTempRepo();
    const worktreeRoot = `${rootDir}-worktree`;
    await createCommittedTaskRepo(
      rootDir,
      "207-cross-worktree-authority.md",
      `id: wi-207
title: Cross-worktree runtime authority
summary: Public command surfaces share the same claim authority.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
tags:
  - afk`,
    );
    runGit(rootDir, [
      "worktree",
      "add",
      "-b",
      "sandcastle/issue-207",
      worktreeRoot,
    ]);

    try {
      const claimed = runCliJson<RuntimeClaimCommandResult>(rootDir, [
        "claim",
        "create",
        "--target",
        "task:wi-207",
        "--holder",
        "sandcastle:agent-a",
        "--worktree",
        rootDir,
        "--json",
      ]);
      expect(claimed.outcome).toBe("acquired");

      const status = runCliJson<{
        claimToken: string;
        state: string;
        claim: { claim_token: string; target_id: string; holder: string };
      }>(worktreeRoot, ["claim", "status", claimed.claimToken, "--json"]);
      expect(status).toMatchObject({
        claimToken: claimed.claimToken,
        state: "active",
        claim: { target_id: "wi-207", holder: "sandcastle:agent-a" },
      });

      const locks = runCliJson<RuntimeLockStatusResult>(worktreeRoot, [
        "lock",
        "status",
        "--claim",
        claimed.claimToken,
        "--json",
      ]);
      expect(locks).toMatchObject({
        claimToken: claimed.claimToken,
        state: "active",
        locks: expect.arrayContaining([
          expect.objectContaining({
            path: "backlog/207-cross-worktree-authority.md",
          }),
        ]),
      });

      let localClaimToken: string | undefined;
      const conflictingLocalStore = openRuntimeSqliteStore({
        rootDir: worktreeRoot,
        databasePath: path.join(
          worktreeRoot,
          ".doc-vader",
          "runtime",
          "runtime.sqlite",
        ),
      });
      try {
        const local = conflictingLocalStore.acquireRuntimeClaim(
          {
            schema_version: RUNTIME_SCHEMA_VERSION,
            target_type: "task",
            target_id: "wi-207",
            holder: "local-sqlite-conflict",
            created_at: "2099-01-01T00:00:00.000Z",
            expires_at: "2099-01-01T04:00:00.000Z",
            entropy: "local-sqlite-must-not-override-authority",
          },
          { initialLockPaths: ["backlog/207-local-conflict.md"] },
        );
        expect(local.outcome).toBe("acquired");
        if (local.outcome === "acquired") {
          localClaimToken = local.claimToken;
        }
      } finally {
        conflictingLocalStore.close();
      }

      const workShow = runCliJson<TaskShowModel>(worktreeRoot, [
        "work",
        "wi-207",
        "show",
        "--json",
      ]);
      expect(workShow).toMatchObject({
        id: "wi-207",
        status: "ready",
        activeLocks: expect.arrayContaining([
          expect.objectContaining({
            claimToken: status.claim.claim_token,
            scopeRef: "wi:207",
          }),
        ]),
      });
      expect(
        workShow.activeLocks?.some(
          (lock) => lock.claimToken === localClaimToken,
        ),
      ).toBe(false);

      const workStatus = runCliJson<{
        runtime?: {
          latestExecutionLog?: {
            claimToken: string;
            state: string;
            lockCount: number;
          };
        };
      }>(worktreeRoot, ["work", "wi-207", "status", "--json"]);
      expect(workStatus.runtime?.latestExecutionLog).toMatchObject({
        claimToken: status.claim.claim_token,
        state: "running",
        lockCount: 1,
      });
    } finally {
      runGit(rootDir, ["worktree", "remove", "--force", worktreeRoot]);
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it(
    "runs canonical checklist mutations, evidence, Gate, and release through public commands",
    { timeout: 30_000 },
    async () => {
      const rootDir = await createTempRepo();
      await createCommittedTaskRepo(
        rootDir,
        "205-checklist-flow.md",
        `id: wi-205
title: Checklist Flow
summary: Complete through inspected checklist operations.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
tags:
  - afk`,
        `## Tasks

- [ ] Complete only through the canonical Work Item resource.

## Acceptance Criteria

- [x] Record evidence before close.
`,
      );
      runGit(rootDir, ["switch", "-c", "sandcastle/issue-205"]);

      const listed = runAdapterJson<{ selectable: Array<{ id: string }> }>(
        rootDir,
        ["list"],
      );
      expect(listed.selectable).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "205" })]),
      );

      const claimed = runAdapterJson<RuntimeClaimCommandResult>(rootDir, [
        "claim-task",
        "205",
        "--holder",
        "sandcastle:agent-a",
        "--branch",
        "sandcastle/issue-205",
        "--json",
      ]);
      runCliJson(rootDir, [
        "work", "wi-205", "update",
        "--input", '{"status":"running","statusReason":"implementation"}',
        "--claim", claimed.claimToken, "--json",
      ]);
      const evidence = JSON.stringify({
        id: "record:wi-205-checklist-flow",
        summary: "Checklist adapter flow",
        observation: "Evidence was recorded before the completion Gate.",
        outcome: "pass",
      });
      expect(
        runAdapterJson<{ taskId: string }>(
          rootDir,
          [
            "record-task",
            "--claim",
            claimed.claimToken,
            "--type",
            "test-result",
            "--payload",
            "-",
          ],
          evidence,
        ),
      ).toMatchObject({ taskId: "wi-205" });

      const initialInspection = runCliJson<{
        checklist: { checks: Array<{ id: string; status: string }> };
      }>(rootDir, ["work", "wi-205", "checklist", "tasks", "--json"]);
      const initialId = initialInspection.checklist.checks[0]!.id;

      runCli(rootDir, [
        "work", "wi-205", "checklist", "tasks", "check", initialId, "complete",
        "--claim", claimed.claimToken, "--evidence", "[[record-wi-205-checklist-flow]]", "--json",
      ]);
      const completedInspection = runCliJson<{
        checklist: { checks: Array<{ id: string; status: string }> };
      }>(rootDir, ["work", "wi-205", "checklist", "tasks", "--json"]);
      const completedId = completedInspection.checklist.checks[0]!.id;
      expect(completedInspection.checklist.checks[0]!.status).toBe("met");

      runCli(rootDir, [
        "work", "wi-205", "checklist", "tasks", "check", completedId, "clear",
        "--claim", claimed.claimToken, "--json",
      ]);
      const clearedInspection = runCliJson<{
        checklist: { checks: Array<{ id: string; status: string }> };
      }>(rootDir, ["work", "wi-205", "checklist", "tasks", "--json"]);
      expect(clearedInspection.checklist.checks[0]!.status).toBe("unmet");

      runCli(rootDir, [
        "work", "wi-205", "checklist", "tasks", "check", clearedInspection.checklist.checks[0]!.id, "complete",
        "--claim", claimed.claimToken, "--evidence", "[[record-wi-205-checklist-flow]]", "--json",
      ]);

      const closed = runAdapterJson<SandcastleCloseResult>(rootDir, [
        "close-task",
        "205",
        "--claim",
        claimed.claimToken,
        "--actual",
        "0",
      ]);
      expect(closed.release.execution.executionLogEntry).toMatchObject({
        state: "completed",
        reason: "success",
      });
      expect(
        await readFile(
          path.join(rootDir, "backlog", "205-checklist-flow.md"),
          "utf8",
        ),
      ).toContain("status: completed");
      withRuntimeStore(rootDir, (store) => {
        expect(store.listClaims()).toHaveLength(0);
      });
    },
  );

  it(
    "revalidates selectable work before claim acquisition",
    { timeout: 30_000 },
    async () => {
      const rootDir = await createTempRepo();
      await createCommittedTaskRepo(
        rootDir,
        "201-claimed-elsewhere.md",
        `id: wi-201
title: Claimed Elsewhere
summary: Runtime claim conflicts should fail before a second claim is created.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: medium
tags:
  - afk`,
      );

      const claimed = runAdapterJson<RuntimeClaimCommandResult>(rootDir, [
        "claim-task",
        "201",
        "--holder",
        "sandcastle:agent-a",
        "--branch",
        "sandcastle/issue-201",
        "--json",
      ]);
      expect(claimed.outcome).toBe("acquired");

      const failedOutput = runAdapterFailure(rootDir, [
        "claim-task",
        "201",
        "--holder",
        "sandcastle:agent-b",
        "--branch",
        "sandcastle/issue-201",
        "--json",
      ]);

      expect(failedOutput).toContain("DV4SANDCASTLE_NOT_SELECTABLE");
      expect(failedOutput).toContain("task_claim_active");

      withRuntimeStore(rootDir, (store) => {
        expect(store.listClaims()).toHaveLength(1);
        expect(store.listClaims()[0]).toMatchObject({
          claim_token: claimed.claimToken,
          target_id: "wi-201",
          holder: "sandcastle:agent-a",
        });
      });
    },
  );

  it(
    "backs view and prompt with canonical work inspection output without mutating state",
    { timeout: 20_000 },
    async () => {
      const rootDir = await createTempRepo();
      await stageWorkGraphUacFixture(rootDir);
      await stageInspectionTemplates(rootDir);

      withRuntimeStore(rootDir, (store) => {
        const claimToken = store.listClaims()[0]?.claim_token;
        expect(claimToken).toBeTruthy();
        if (!claimToken) {
          throw new Error("Expected staged fixture claim.");
        }
        const lockResult = store.acquireRuntimeScopeLocks(claimToken, [
          {
            scopeRef: "wi:70001",
            lockMode: "read",
          },
        ]);
        expect(lockResult.outcome).toBe("acquired");
      });

      const before = await snapshotFileHashes(rootDir);
      const canonicalShowJson = runCliJson<TaskShowModel>(rootDir, [
        "work",
        "wi-70001",
        "show",
        "--json",
      ]);
      const canonicalPrompt = runCli(rootDir, ["work", "wi-70001", "prompt"]);

      const view = runAdapterJson<TaskShowModel>(rootDir, ["view", "70001"]);
      const prompt = runAdapter(rootDir, ["prompt", "70001"]);

      expect(view).toEqual(canonicalShowJson);
      expect(prompt).toBe(canonicalPrompt);

      const after = await snapshotFileHashes(rootDir);
      expect(after).toEqual(before);
    },
  );

  it(
    "verifies locks, releases through runtime authority, and recovers halted work",
    { timeout: 30_000 },
    async () => {
      const rootDir = await createTempRepo();
      await createCommittedTaskRepo(
        rootDir,
        "202-runtime-recover.md",
        `id: wi-202
title: Runtime Recover
summary: Release and recover through runtime authority.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
tags:
  - afk`,
        `## Tasks

- [x] Exercise runtime release and recovery.

## Acceptance Criteria

- [x] Recover halted work through the runtime authority.
`,
      );
      runGit(rootDir, ["switch", "-c", "sandcastle/issue-202"]);

      const claimed = runAdapterJson<RuntimeClaimCommandResult>(rootDir, [
        "claim-task",
        "202",
        "--holder",
        "sandcastle:agent-a",
        "--branch",
        "sandcastle/issue-202",
        "--json",
      ]);
      expect(claimed.outcome).toBe("acquired");

      const lockCreated = runCliJson<RuntimeLockCreateResult>(rootDir, [
        "lock",
        "create",
        "--claim",
        claimed.claimToken,
        "backlog/202-runtime-recover.md",
        "--json",
      ]);
      expect(lockCreated.outcome).toBe("acquired");

      const lockStatus = runAdapterJson<RuntimeLockStatusResult>(rootDir, [
        "lock-status",
        "--claim",
        claimed.claimToken,
        "--json",
      ]);
      expect(lockStatus).toMatchObject({
        claimToken: claimed.claimToken,
        state: "active",
        locks: [
          {
            path: "backlog/202-runtime-recover.md",
            state: "clean",
          },
        ],
      });

      const released = runCliJson<RuntimeReleaseResult>(rootDir, [
        "claim",
        "release",
        claimed.claimToken,
        "--outcome",
        "blocked",
        "--code",
        "x-runtime-task-blocked",
        "--message",
        "Blocked by Sandcastle adapter.",
        "--json",
      ]);
      expect(released).toMatchObject({
        claimToken: claimed.claimToken,
        executionLogEntry: {
          state: "halted",
          reason: "blocked",
        },
        locksRemoved: 1,
      });

      const blockedClaimAttempt = runAdapterFailure(rootDir, [
        "claim-task",
        "202",
        "--holder",
        "sandcastle:agent-b",
        "--branch",
        "sandcastle/issue-202",
        "--json",
      ]);
      expect(blockedClaimAttempt).toContain("DV4SANDCASTLE_NOT_SELECTABLE");
      expect(blockedClaimAttempt).toContain("execution_not_ready");

      const recovered = runAdapterJson<RuntimeRecoverResult>(rootDir, [
        "recover-task",
        "202",
        "--branch",
        "sandcastle/issue-202",
        "--json",
      ]);
      expect(recovered).toMatchObject({
        taskId: "wi-202",
        executionLogEntry: {
          state: "completed",
          reason: "success",
        },
        transition: {
          frontmatter: {
            status: "ready",
            status_reason: "recoverable",
          },
        },
      });

      withRuntimeStore(rootDir, (store) => {
        expect(store.listClaims()).toHaveLength(0);
        expect(store.listExecutionLogEntries().at(-1)).toMatchObject({
          target_id: "wi-202",
          state: "completed",
          reason: "success",
        });
      });

      const reclaimed = runAdapterJson<RuntimeClaimCommandResult>(rootDir, [
        "claim-task",
        "202",
        "--holder",
        "sandcastle:agent-b",
        "--branch",
        "sandcastle/issue-202",
        "--json",
      ]);
      expect(reclaimed.outcome).toBe("acquired");
    },
  );

  it(
    "closes through a repository-configured transition script after recording evidence",
    { timeout: 30_000 },
    async () => {
      const rootDir = await createTempRepo();
      writeBacklogConsumerConfig(rootDir, {
        sandcastle: {
          close: {
            transitionScript: "scripts/sandcastle/close-success.mjs",
          },
        },
      });
      await createCommittedTaskRepo(
        rootDir,
        "203-close-success.md",
        `id: wi-203
title: Close Success
summary: Close through a repository transition script.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
tags:
  - afk`,
        `## Tasks

- [x] Mark the repository-specific checklist.

## Acceptance Criteria

- [x] Persist transition-side effects outside the backlog file.
`,
      );
      inspectCompletedChecks(rootDir, "203");
      await writeCloseScript(
        rootDir,
        "scripts/sandcastle/close-success.mjs",
        `import fs from "node:fs";
import path from "node:path";

const payload = JSON.parse(fs.readFileSync(0, "utf8"));
const notesPath = path.resolve(process.cwd(), "notes/close-success.txt");
const lockPaths = [payload.task.filePath, "notes/close-success.txt"];

if (payload.mode === "plan") {
  process.stdout.write(JSON.stringify({ lockPaths }, null, 2));
  process.exit(0);
}

fs.mkdirSync(path.dirname(notesPath), { recursive: true });
fs.writeFileSync(
  notesPath,
  \`closed \${payload.task.id} with \${payload.record?.evidenceLink ?? "no-evidence"}\\n\`,
  "utf8",
);
process.stdout.write(JSON.stringify({ lockPaths }, null, 2));
`,
      );
      commitRepoState(rootDir, "chore: add close transition script");
      runGit(rootDir, ["switch", "-c", "sandcastle/issue-203"]);
      await writeFile(
        path.join(rootDir, "implementation.txt"),
        "feature branch work\n",
        "utf8",
      );
      commitRepoState(rootDir, "feat: implementation progress");

      const payload = JSON.stringify({
        id: "record:wi-203-close",
        summary: "Close validation",
        observation: "Close recorded evidence before terminal release.",
        outcome: "pass",
      });

      const claimed = runAdapterJson<RuntimeClaimCommandResult>(rootDir, [
        "claim-task",
        "203",
        "--holder",
        "sandcastle:agent-a",
        "--branch",
        "sandcastle/issue-203",
        "--json",
      ]);
      expect(claimed.outcome).toBe("acquired");

      const closed = runAdapterJson<SandcastleCloseResult>(
        rootDir,
        [
          "close-task",
          "203",
          "--claim",
          claimed.claimToken,
          "--payload",
          "-",
          "--record-type",
          "test-result",
          "--actual",
          "0",
        ],
        payload,
      );
      expect(closed).toMatchObject({
        taskId: "wi-203",
        claimToken: claimed.claimToken,
        lockPaths: expect.arrayContaining([
          "backlog/203-close-success.md",
          "backlog/records/record-wi-203-close.md",
          "notes/close-success.txt",
        ]),
        record: {
          taskId: "wi-203",
          evidenceLink: "[[record-wi-203-close]]",
          record: {
            id: "record:wi-203-close",
          },
        },
        transitionScript: {
          path: "scripts/sandcastle/close-success.mjs",
          lockPaths: expect.arrayContaining([
            "backlog/203-close-success.md",
            "notes/close-success.txt",
          ]),
        },
        validation: {
          claimId: claimed.claimToken,
          taskId: "wi-203",
          dryRun: true,
        },
        release: {
          claimId: claimed.claimToken,
          taskId: "wi-203",
          transition: {
            workItem: {
              frontmatter: {
                status: "completed",
                status_reason: "completed",
              },
            },
          },
          execution: {
            executionLogEntry: {
              state: "completed",
              reason: "success",
            },
          },
        },
      });

      const taskDocument = await readFile(
        path.join(rootDir, "backlog", "203-close-success.md"),
        "utf8",
      );
      expect(taskDocument).toContain("status: completed");
      expect(taskDocument).toContain("[[record-wi-203-close]]");
      expect(taskDocument).toContain(
        "- [x] Mark the repository-specific checklist.",
      );
      expect(taskDocument).toContain(
        "- [x] Persist transition-side effects outside the backlog file.",
      );
      expect(
        await readFile(
          path.join(rootDir, "notes", "close-success.txt"),
          "utf8",
        ),
      ).toContain("[[record-wi-203-close]]");

      withRuntimeStore(rootDir, (store) => {
        expect(store.listClaims()).toHaveLength(0);
        expect(store.listLocks()).toHaveLength(0);
        expect(store.listExecutionLogEntries().at(-1)).toMatchObject({
          target_id: "wi-203",
          state: "completed",
          reason: "success",
        });
      });
    },
  );

  it(
    "reports an expired runtime claim before attempting a Sandcastle close",
    { timeout: 30_000 },
    async () => {
      const rootDir = await createTempRepo();
      await createCommittedTaskRepo(
        rootDir,
        "208-close-expired-claim.md",
        `id: wi-208
title: Expired Close Claim
summary: An expired claim must block the public close command.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: high
actual: 0
links:
  evidence:
    - '[[record-close-expired-claim]]'
tags:
  - afk`,
        `## Tasks

- [x] Prepare an expired claim diagnostic.

## Acceptance Criteria

- [x] Keep the close flow fail-closed.
`,
      );

      const claimToken = createExpiredRuntimeTaskClaim(rootDir, "wi-208");

      const failure = runAdapterFailure(rootDir, [
        "close-task",
        "208",
        "--claim",
        claimToken,
      ]);

      expect(failure).toContain(
        `Runtime claim '${claimToken}' is expired; inspect or recover before close.`,
      );
    },
  );

  it(
    "reports missing linked evidence through the public Sandcastle close command",
    { timeout: 30_000 },
    async () => {
      const rootDir = await createTempRepo();
      await createCommittedTaskRepo(
        rootDir,
        "209-close-missing-evidence.md",
        `id: wi-209
title: Missing Close Evidence
summary: A close without linked evidence must fail at the terminal Gate.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: high
tags:
  - afk`,
        `## Tasks

- [x] Exercise the missing-evidence diagnostic.

## Acceptance Criteria

- [x] Do not close without linked evidence.
`,
      );
      const claimed = runAdapterJson<RuntimeClaimCommandResult>(rootDir, [
        "claim-task",
        "209",
        "--holder",
        "sandcastle:agent-a",
        "--json",
      ]);

      const failure = runAdapterFailure(rootDir, [
        "close-task",
        "209",
        "--claim",
        claimed.claimToken,
        "--actual",
        "0",
      ]);

      expect(parseStructuredDiagnostic(failure)).toMatchObject({
        error: {
          code: "WORK_UPDATE_CLOSED_METADATA_REQUIRED",
          message: expect.stringContaining(
            "links.evidence as a non-empty array of schema-valid links",
          ),
        },
      });
    },
  );

  it(
    "reports an invalid lifecycle transition through the public Sandcastle close command",
    { timeout: 30_000 },
    async () => {
      const rootDir = await createTempRepo();
      await createCommittedTaskRepo(
        rootDir,
        "210-close-lifecycle-block.md",
        `id: wi-210
title: Lifecycle-blocked Close
summary: Closing from a paused lifecycle state must be refused.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: high
actual: 0
links:
  evidence:
    - '[[record-close-lifecycle-block]]'
tags:
  - afk`,
        `## Tasks

- [x] Exercise the lifecycle transition diagnostic.

## Acceptance Criteria

- [x] Require an allowed transition before close.
`,
      );
      const claimed = runAdapterJson<RuntimeClaimCommandResult>(rootDir, [
        "claim-task",
        "210",
        "--holder",
        "sandcastle:agent-a",
        "--json",
      ]);
      const taskPath = path.join(
        rootDir,
        "backlog",
        "210-close-lifecycle-block.md",
      );
      await writeFile(
        taskPath,
        (await readFile(taskPath, "utf8"))
          .replace("status: ready", "status: paused")
          .replace("status_reason: auto", "status_reason: policy"),
        "utf8",
      );

      const failure = runAdapterFailure(rootDir, [
        "close-task",
        "210",
        "--claim",
        claimed.claimToken,
        "--actual",
        "0",
      ]);

      expect(parseStructuredDiagnostic(failure)).toMatchObject({
        error: {
          code: "WORK_UPDATE_INVALID_TRANSITION",
          message:
            "Transition from 'paused' to 'completed' with status_reason 'completed' is not allowed by the work-management profile.",
        },
      });
    },
  );

  it(
    "reports check blockers before evidence and lifecycle blockers during close",
    { timeout: 30_000 },
    async () => {
      const rootDir = await createTempRepo();
      await createCommittedTaskRepo(
        rootDir,
        "211-close-check-precedence.md",
        `id: wi-211
title: Check-first Close Diagnostic
summary: The terminal Gate must report the first check blocker deterministically.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: high
tags:
  - afk`,
        `## Tasks

- [ ] Leave this check unmet.

## Acceptance Criteria

- [x] Include evidence and lifecycle blockers too.
`,
      );
      const claimed = runAdapterJson<RuntimeClaimCommandResult>(rootDir, [
        "claim-task",
        "211",
        "--holder",
        "sandcastle:agent-a",
        "--json",
      ]);
      const taskPath = path.join(
        rootDir,
        "backlog",
        "211-close-check-precedence.md",
      );
      await writeFile(
        taskPath,
        (await readFile(taskPath, "utf8"))
          .replace("status: ready", "status: paused")
          .replace("status_reason: auto", "status_reason: policy"),
        "utf8",
      );

      const diagnostic = parseStructuredDiagnostic(
        runAdapterFailure(rootDir, [
          "close-task",
          "211",
          "--claim",
          claimed.claimToken,
          "--actual",
          "0",
        ]),
      );

      expect(diagnostic).toMatchObject({
        error: {
          code: "TASK_COMMAND_FAILED",
          message:
            "Cannot transition 'wi-211' to 'completed' with unchecked completion criteria:\n- Tasks: Leave this check unmet.",
        },
      });
      expect(diagnostic.error.message).not.toContain("links.evidence");
      expect(diagnostic.error.message).not.toContain(
        "Transition from 'paused'",
      );
    },
  );
  it(
    "does not let a transition script satisfy unmet checks after evidence is recorded",
    { timeout: 30_000 },
    async () => {
      const rootDir = await createTempRepo();
      writeBacklogConsumerConfig(rootDir, {
        sandcastle: {
          close: {
            transitionScript:
              "scripts/sandcastle/close-must-not-bypass-gate.mjs",
          },
        },
      });
      await createCommittedTaskRepo(
        rootDir,
        "206-close-gate-before-script.md",
        `id: wi-206
title: Close Gate Before Script
summary: A transition script must not bypass completion checks.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
tags:
  - afk`,
        `## Tasks

- [ ] Complete through the check adapter.

## Acceptance Criteria

- [x] Record evidence before close.
`,
      );
      await writeCloseScript(
        rootDir,
        "scripts/sandcastle/close-must-not-bypass-gate.mjs",
        `import fs from "node:fs";
import path from "node:path";

const payload = JSON.parse(fs.readFileSync(0, "utf8"));
const markerPath = path.resolve(process.cwd(), "notes/transition-ran.txt");
const planMarkerPath = path.resolve(process.cwd(), "notes/transition-plan-ran.txt");
const taskPath = path.resolve(process.cwd(), payload.task.filePath);
const lockPaths = [payload.task.filePath, "notes/transition-ran.txt"];

if (payload.mode === "plan") {
  fs.mkdirSync(path.dirname(planMarkerPath), { recursive: true });
  fs.writeFileSync(planMarkerPath, "transition planned\\n", "utf8");
  process.stdout.write(JSON.stringify({ lockPaths }, null, 2));
  process.exit(0);
}

fs.mkdirSync(path.dirname(markerPath), { recursive: true });
fs.writeFileSync(markerPath, "transition applied\\n", "utf8");
fs.writeFileSync(
  taskPath,
  fs
    .readFileSync(taskPath, "utf8")
    .replace("- [ ] Complete through the check adapter.", "- [x] Complete through the check adapter."),
  "utf8",
);
process.stdout.write(JSON.stringify({ lockPaths }, null, 2));
`,
      );
      commitRepoState(rootDir, "chore: add gate bypass transition script");
      runGit(rootDir, ["switch", "-c", "sandcastle/issue-206"]);
      await writeFile(
        path.join(rootDir, "implementation.txt"),
        "feature branch work\n",
        "utf8",
      );
      commitRepoState(rootDir, "feat: implementation progress");

      const claimed = runAdapterJson<RuntimeClaimCommandResult>(rootDir, [
        "claim-task",
        "206",
        "--holder",
        "sandcastle:agent-a",
        "--branch",
        "sandcastle/issue-206",
        "--json",
      ]);
      const failedOutput = runAdapterFailure(
        rootDir,
        [
          "close-task",
          "206",
          "--claim",
          claimed.claimToken,
          "--payload",
          "-",
          "--record-type",
          "test-result",
        ],
        JSON.stringify({
          id: "record:wi-206-close",
          summary: "Gate ordering validation",
          observation: "Evidence is recorded before the completion Gate.",
          outcome: "pass",
        }),
      );

      expect(parseStructuredDiagnostic(failedOutput)).toMatchObject({
        error: {
          code: "TASK_COMMAND_FAILED",
          message:
            "Cannot transition 'wi-206' to 'completed' with unchecked completion criteria:\n- Tasks: Complete through the check adapter.",
        },
      });
      expect(
        existsSync(path.join(rootDir, "notes", "transition-ran.txt")),
      ).toBe(false);
      expect(
        existsSync(path.join(rootDir, "notes", "transition-plan-ran.txt")),
      ).toBe(false);
      expect(
        existsSync(
          path.join(rootDir, "backlog", "records", "record-wi-206-close.md"),
        ),
      ).toBe(false);
      expect(
        await readFile(
          path.join(rootDir, "backlog", "206-close-gate-before-script.md"),
          "utf8",
        ),
      ).toContain("- [ ] Complete through the check adapter.");
    },
  );

  it(
    "halts close failures into recoverable runtime state after evidence is recorded",
    { timeout: 30_000 },
    async () => {
      const rootDir = await createTempRepo();
      writeBacklogConsumerConfig(rootDir, {
        sandcastle: {
          close: {
            transitionScript: "scripts/sandcastle/close-failure.mjs",
          },
        },
      });
      await createCommittedTaskRepo(
        rootDir,
        "204-close-failure.md",
        `id: wi-204
title: Close Failure
summary: Close script failures should remain recoverable.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
tags:
  - afk`,
        `## Tasks

- [x] Mark the repository-specific checklist.

## Acceptance Criteria

- [x] Leave failed close attempts recoverable.
`,
      );
      inspectCompletedChecks(rootDir, "204");
      const originalEvidence = `---
id: record:wi-204-close
title: Pre-existing close evidence
summary: This record predates the close attempt.
type: record
subtype: test-result
lifecycle: active
status: ready
status_reason: recorded
---

## Observation

Preserve this evidence on a failed close.\n`;
      await writeCloseScript(
        rootDir,
        "backlog/records/record-wi-204-close.md",
        originalEvidence,
      );
      await writeCloseScript(
        rootDir,
        "scripts/sandcastle/close-failure.mjs",
        `import fs from "node:fs";

const payload = JSON.parse(fs.readFileSync(0, "utf8"));
const lockPaths = [payload.task.filePath];

if (payload.mode === "plan") {
  process.stdout.write(JSON.stringify({ lockPaths }, null, 2));
  process.exit(0);
}

throw new Error("Transition script failed after evidence recording.");
`,
      );
      commitRepoState(rootDir, "chore: add failing close transition script");
      runGit(rootDir, ["switch", "-c", "sandcastle/issue-204"]);
      await writeFile(
        path.join(rootDir, "implementation.txt"),
        "feature branch work\n",
        "utf8",
      );
      commitRepoState(rootDir, "feat: implementation progress");

      const payload = JSON.stringify({
        id: "record:wi-204-close",
        summary: "Close failure validation",
        observation:
          "Close records evidence before a repository script failure.",
        outcome: "warn",
      });

      const claimed = runAdapterJson<RuntimeClaimCommandResult>(rootDir, [
        "claim-task",
        "204",
        "--holder",
        "sandcastle:agent-a",
        "--branch",
        "sandcastle/issue-204",
        "--json",
      ]);
      expect(claimed.outcome).toBe("acquired");

      const failedOutput = await measureStage("close task failure", () =>
        runAdapterFailure(
          rootDir,
          [
            "close-task",
            "204",
            "--claim",
            claimed.claimToken,
            "--payload",
            "-",
            "--record-type",
            "test-result",
            "--actual",
            "0",
          ],
          payload,
        ),
      );
      expect(failedOutput).toContain(
        "Transition script failed after evidence recording.",
      );

      const failedTaskDocument = await readFile(
        path.join(rootDir, "backlog", "204-close-failure.md"),
        "utf8",
      );
      expect(failedTaskDocument).not.toContain("[[record-wi-204-close]]");
      expect(failedTaskDocument).toContain("status: ready");

      withRuntimeStore(rootDir, (store) => {
        expect(store.listClaims()).toHaveLength(0);
        expect(store.listExecutionLogEntries().at(-1)).toMatchObject({
          target_id: "wi-204",
          state: "halted",
          reason: "invalid",
        });
      });

      const recovered = runAdapterJson<RuntimeRecoverResult>(rootDir, [
        "recover-task",
        "204",
        "--branch",
        "sandcastle/issue-204",
        "--force",
        "reconcile",
        "--json",
      ]);
      expect(recovered).toMatchObject({
        taskId: "wi-204",
        executionLogEntry: {
          state: "completed",
          reason: "success",
        },
        transition: {
          frontmatter: {
            status: "ready",
            status_reason: "recoverable",
          },
        },
      });

      const recoveredTaskDocument = await readFile(
        path.join(rootDir, "backlog", "204-close-failure.md"),
        "utf8",
      );
      expect(recoveredTaskDocument).not.toContain("[[record-wi-204-close]]");
      expect(recoveredTaskDocument).toContain("status_reason: recoverable");
      expect(
        await readFile(
          path.join(rootDir, "backlog", "records", "record-wi-204-close.md"),
          "utf8",
        ),
      ).toBe(originalEvidence);
    },
  );
});
