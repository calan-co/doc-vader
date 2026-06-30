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
import { openRuntimeSqliteStore } from "../lib/runtime/sqlite-store.js";
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
  await writeFile(path.join(rootDir, ".gitignore"), ".doc-vader/runtime/\n", "utf8");
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

async function snapshotFileHashes(rootDir: string): Promise<Map<string, string>> {
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
    tempDirs.splice(0, tempDirs.length).map((dir) =>
      rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe("dv4sandcastle runtime smoke", () => {
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
        "show",
        "70001",
        "--json",
      ]);
      const canonicalPrompt = runCli(rootDir, ["work", "prompt", "70001"]);

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

- [ ] Mark the repository-specific checklist.

## Acceptance Criteria

- [ ] Persist transition-side effects outside the backlog file.
`,
      );
      await writeCloseScript(
        rootDir,
        "scripts/sandcastle/close-success.mjs",
        `import fs from "node:fs";
import path from "node:path";

const payload = JSON.parse(fs.readFileSync(0, "utf8"));
const taskPath = path.resolve(process.cwd(), payload.task.filePath);
const notesPath = path.resolve(process.cwd(), "notes/close-success.txt");
const lockPaths = [payload.task.filePath, "notes/close-success.txt"];

if (payload.mode === "plan") {
  process.stdout.write(JSON.stringify({ lockPaths }, null, 2));
  process.exit(0);
}

const task = fs
  .readFileSync(taskPath, "utf8")
  .replace("- [ ] Mark the repository-specific checklist.", "- [x] Mark the repository-specific checklist.")
  .replace("- [ ] Persist transition-side effects outside the backlog file.", "- [x] Persist transition-side effects outside the backlog file.");
fs.writeFileSync(taskPath, task, "utf8");
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

      const closed = runAdapterJson<SandcastleCloseResult>(rootDir, [
        "close-task",
        "203",
        "--claim",
        claimed.claimToken,
        "--payload",
        "-",
        "--record-type",
        "test-result",
      ], payload);
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
      expect(taskDocument).toContain("- [x] Mark the repository-specific checklist.");
      expect(taskDocument).toContain(
        "- [x] Persist transition-side effects outside the backlog file.",
      );
      expect(
        await readFile(path.join(rootDir, "notes", "close-success.txt"), "utf8"),
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

- [ ] Mark the repository-specific checklist.

## Acceptance Criteria

- [ ] Leave failed close attempts recoverable.
`,
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
        observation: "Close records evidence before a repository script failure.",
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

      const failedOutput = runAdapterFailure(rootDir, [
        "close-task",
        "204",
        "--claim",
        claimed.claimToken,
        "--payload",
        "-",
        "--record-type",
        "test-result",
      ], payload);
      expect(failedOutput).toContain(
        "Transition script failed after evidence recording.",
      );

      const failedTaskDocument = await readFile(
        path.join(rootDir, "backlog", "204-close-failure.md"),
        "utf8",
      );
      expect(failedTaskDocument).toContain("[[record-wi-204-close]]");
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
        existsSync(
          path.join(rootDir, "backlog", "records", "record-wi-204-close.md"),
        ),
      ).toBe(false);
    },
  );
});
