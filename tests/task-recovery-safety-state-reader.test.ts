import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cliTaskRecoverySafetyStateReader,
  createCliTaskRecoverySafetyStateReader,
  esGitTaskRecoverySafetyStateReader,
  type TaskRecoverySafetyStateReader,
} from "../lib/task/recovery-safety-state-reader.js";
import {
  collectTaskRecoverySafetyGitState,
  TaskRecoverySafetyStateError,
} from "../lib/task/recovery-state.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createRepository(): Promise<string> {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "doc-vader-recovery-safety-"),
  );
  temporaryDirectories.push(rootDir);
  execFileSync("git", ["init", "--initial-branch", "main"], {
    cwd: rootDir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.email", "agent@example.com"], {
    cwd: rootDir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Agent"], {
    cwd: rootDir,
    stdio: "ignore",
  });
  await fs.writeFile(path.join(rootDir, "tracked.txt"), "base\n", "utf8");
  execFileSync("git", ["add", "tracked.txt"], { cwd: rootDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "chore: base"], {
    cwd: rootDir,
    stdio: "ignore",
  });
  return rootDir;
}

const readers: Array<[string, TaskRecoverySafetyStateReader]> = [
  ["Git CLI", cliTaskRecoverySafetyStateReader],
  ["es-git", esGitTaskRecoverySafetyStateReader],
];

describe("task recovery safety-state readers", () => {
  for (const [name, reader] of readers) {
    it(`${name} explicitly reports every clean safety fact`, async () => {
      const rootDir = await createRepository();

      await expect(reader.readSafetyState({ rootDir })).resolves.toEqual({
        repository: { state: "available" },
        status: { state: "ok", value: [] },
        branch: {
          state: "ok",
          value: { currentBranch: "main", detached: false },
        },
        merge: { state: "ok", value: false },
        rebase: { state: "ok", value: false },
        branchDiff: { state: "ok", value: [] },
      });
    });

    it(`${name} reads dirty paths and branch-diff paths`, async () => {
      const rootDir = await createRepository();
      execFileSync("git", ["switch", "-c", "feature/recovery-safety"], {
        cwd: rootDir,
        stdio: "ignore",
      });
      await fs.writeFile(path.join(rootDir, "branch-only.txt"), "branch\n", "utf8");
      execFileSync("git", ["add", "branch-only.txt"], { cwd: rootDir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "feat: branch change"], {
        cwd: rootDir,
        stdio: "ignore",
      });
      await fs.writeFile(path.join(rootDir, "tracked.txt"), "dirty\n", "utf8");
      await fs.writeFile(path.join(rootDir, "untracked.txt"), "untracked\n", "utf8");

      const state = await reader.readSafetyState({ rootDir });

      expect(state.status).toMatchObject({
        state: "ok",
        value: expect.arrayContaining([
          expect.objectContaining({ path: "tracked.txt" }),
          expect.objectContaining({ path: "untracked.txt", status: "??" }),
        ]),
      });
      expect(state.branchDiff).toMatchObject({
        state: "ok",
        value: expect.arrayContaining(["branch-only.txt"]),
      });
    });

    it(`${name} excludes ignored paths from dirty safety facts`, async () => {
      const rootDir = await createRepository();
      await fs.writeFile(path.join(rootDir, ".gitignore"), "ignored/\n", "utf8");
      execFileSync("git", ["add", ".gitignore"], { cwd: rootDir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "chore: ignore runtime"], {
        cwd: rootDir,
        stdio: "ignore",
      });
      await fs.mkdir(path.join(rootDir, "ignored"));
      await fs.writeFile(path.join(rootDir, "ignored", "state"), "runtime\n", "utf8");

      await expect(reader.readSafetyState({ rootDir })).resolves.toMatchObject({
        status: { state: "ok", value: [] },
      });
    });

    it(`${name} reports detached HEAD explicitly`, async () => {
      const rootDir = await createRepository();
      const oid = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: rootDir,
        encoding: "utf8",
      }).trim();
      execFileSync("git", ["checkout", "--detach", oid], {
        cwd: rootDir,
        stdio: "ignore",
      });

      await expect(reader.readSafetyState({ rootDir })).resolves.toMatchObject({
        repository: { state: "available" },
        branch: { state: "ok", value: { detached: true } },
      });
    });

    it(`${name} reads a linked worktree`, async () => {
      const rootDir = await createRepository();
      const worktreeDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "doc-vader-recovery-safety-worktree-"),
      );
      temporaryDirectories.push(worktreeDir);
      execFileSync(
        "git",
        ["worktree", "add", "-b", "feature/linked-safety", worktreeDir],
        { cwd: rootDir, stdio: "ignore" },
      );

      await expect(reader.readSafetyState({ rootDir: worktreeDir })).resolves.toMatchObject({
        repository: { state: "available" },
        branch: {
          state: "ok",
          value: { currentBranch: "feature/linked-safety", detached: false },
        },
      });
    });
  }

  it("selects the es-git reader when recovery does not inject a fallback", async () => {
    const rootDir = await createRepository();
    const readSafetyState = vi.spyOn(
      esGitTaskRecoverySafetyStateReader,
      "readSafetyState",
    );

    try {
      await expect(
        collectTaskRecoverySafetyGitState({
          rootDir,
          taskFilePath: "backlog/task.md",
        }),
      ).resolves.toMatchObject({
        currentBranch: "main",
        branchDiffPaths: [],
      });
      expect(readSafetyState).toHaveBeenCalledOnce();
      expect(readSafetyState).toHaveBeenCalledWith({ rootDir });
    } finally {
      readSafetyState.mockRestore();
    }
  });

  it("measures the CLI subprocesses avoided by the default reader", async () => {
    const rootDir = await createRepository();
    const logPath = path.join(rootDir, "git-invocations.log");
    const gitExecutable = path.join(rootDir, "git");
    const systemGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    await fs.writeFile(
      gitExecutable,
      `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(logPath)}
exec ${JSON.stringify(systemGit)} "$@"
`,
      { encoding: "utf8", mode: 0o755 },
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${rootDir}${path.delimiter}${previousPath ?? ""}`;
    try {
      await createCliTaskRecoverySafetyStateReader({ gitExecutable })
        .readSafetyState({ rootDir });
      const cliInvocationCount = (await fs.readFile(logPath, "utf8"))
        .split("\\n")
        .filter(Boolean).length;

      await collectTaskRecoverySafetyGitState({
        rootDir,
        taskFilePath: "backlog/task.md",
      });
      const defaultInvocationCount = (await fs.readFile(logPath, "utf8"))
        .split("\\n")
        .filter(Boolean).length - cliInvocationCount;

      expect(cliInvocationCount).toBeGreaterThan(0);
      expect(defaultInvocationCount).toBe(0);
    } finally {
      if (previousPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = previousPath;
      }
    }
  });

  it("distinguishes an unavailable repository from safety reads that were not attempted", async () => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "doc-vader-recovery-safety-unavailable-"),
    );
    temporaryDirectories.push(rootDir);

    await expect(
      cliTaskRecoverySafetyStateReader.readSafetyState({ rootDir }),
    ).resolves.toEqual({
      repository: { state: "unavailable" },
      status: { state: "not-read", reason: "repository-unavailable" },
      branch: { state: "not-read", reason: "repository-unavailable" },
      merge: { state: "not-read", reason: "repository-unavailable" },
      rebase: { state: "not-read", reason: "repository-unavailable" },
      branchDiff: { state: "not-read", reason: "repository-unavailable" },
    });
  });

  it("propagates an incomplete safety fact as a typed fail-closed error", async () => {
    const rootDir = await createRepository();
    const reader: TaskRecoverySafetyStateReader = {
      async readSafetyState() {
        return {
          repository: { state: "available" },
          status: {
            state: "failed",
            error: { operation: "status", message: "status failed" },
          },
          branch: { state: "ok", value: { currentBranch: "main", detached: false } },
          merge: { state: "ok", value: false },
          rebase: { state: "ok", value: false },
          branchDiff: { state: "ok", value: [] },
        };
      },
    };

    await expect(
      collectTaskRecoverySafetyGitState({
        rootDir,
        taskFilePath: "backlog/task.md",
        reader,
      }),
    ).rejects.toMatchObject({
      name: "TaskRecoverySafetyStateError",
      code: "TASK_RECOVERY_GIT_SAFETY_READ_FAILED",
      details: { fact: "status", operation: "status" },
    } satisfies Partial<TaskRecoverySafetyStateError>);
  });
});
