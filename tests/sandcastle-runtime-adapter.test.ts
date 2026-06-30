import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { openRuntimeSqliteStore } from "../lib/runtime/sqlite-store.js";
import { writeBacklogConsumerConfig } from "./helpers/backlog-consumer-config.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const adapterPath = path.resolve(__dirname, "../scripts/sandcastle/dv-adapter.ts");
const cliPath = path.resolve(__dirname, "../cli/doc-vader.ts");

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

function runAdapter(rootDir: string, args: string[]): string {
  return execFileSync(
    process.execPath,
    ["--import", tsxImport, adapterPath, ...args],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "true",
      },
    },
  );
}

function runCli(rootDir: string, args: string[]): string {
  return execFileSync(
    process.execPath,
    ["--import", tsxImport, cliPath, ...args],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "true",
      },
    },
  );
}

function runAdapterJson<T>(rootDir: string, args: string[]): T {
  return JSON.parse(runAdapter(rootDir, args)) as T;
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

function runAdapterFailure(rootDir: string, args: string[]): string {
  try {
    runAdapter(rootDir, args);
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
): Promise<void> {
  await initGitRepo(rootDir);
  await writeTask(rootDir, fileName, frontmatter);
  commitRepoState(rootDir, "chore: base");
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) =>
      rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe("sandcastle runtime adapter", () => {
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
      "claim",
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
  });

  it("revalidates selectable work before claim acquisition", async () => {
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
      "claim",
      "201",
      "--holder",
      "sandcastle:agent-a",
      "--branch",
      "sandcastle/issue-201",
      "--json",
    ]);
    expect(claimed.outcome).toBe("acquired");

    const failedOutput = runAdapterFailure(rootDir, [
      "claim",
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
  });

  it(
    "verifies locks, releases through runtime authority, and recovers halted work",
    { timeout: 20_000 },
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
        "claim",
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

      const released = runAdapterJson<RuntimeReleaseResult>(rootDir, [
        "release",
        "--claim",
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
        "claim",
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
        "recover",
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
        "claim",
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
});
