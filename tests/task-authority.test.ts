import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cliWorkItemRepositoryWorktreeContextReader,
  createTaskAuthorityTrace,
  defaultWorkItemRepositoryWorktreeContextReader,
  esGitWorkItemRepositoryWorktreeContextReader,
  readTaskAuthorityGitContext,
  resolveGitRoot,
  resolveTaskAuthorityFromGitContext,
} from "../lib/task/authority.js";
import { selectReadyTasks } from "../lib/task/ready.js";
import {
  openRuntimeSqliteStore,
  RUNTIME_SCHEMA_VERSION,
} from "../lib/runtime/sqlite-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

function git(rootDir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: rootDir, encoding: "utf8" }).trim();
}

async function createGitFixture(): Promise<string> {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "doc-vader-task-authority-"),
  );
  temporaryDirectories.push(rootDir);
  await fs.mkdir(path.join(rootDir, "backlog"), { recursive: true });
  await fs.writeFile(path.join(rootDir, "README.md"), "fixture\n", "utf8");
  git(rootDir, ["init", "--initial-branch", "main"]);
  git(rootDir, ["config", "user.email", "agent@example.com"]);
  git(rootDir, ["config", "user.name", "Agent"]);
  git(rootDir, ["add", "."]);
  git(rootDir, ["commit", "-m", "fixture"]);
  return fs.realpath(rootDir);
}

async function writeReadyTask(
  rootDir: string,
  id: string,
  options: { title?: string; status?: string } = {},
): Promise<void> {
  await fs.writeFile(
    path.join(rootDir, "backlog", `${id}.md`),
    `---\nid: ${id}\ntitle: ${options.title ?? id}\ntype: work-item\nlifecycle: active\nstatus: ${options.status ?? "ready"}\ntags:\n  - afk\n---\n\n## Goal\n\nReady fixture.\n`,
    "utf8",
  );
}

function recordCompletedExecution(
  rootDir: string,
  taskId: string,
  metadata: Record<string, unknown>,
): void {
  const store = openRuntimeSqliteStore({ rootDir });
  try {
    const claim = store.acquireRuntimeClaim({
      schema_version: RUNTIME_SCHEMA_VERSION,
      target_type: "task",
      target_id: taskId,
      holder: "agent@example.com",
      created_at: "2099-01-01T00:00:00.000Z",
      expires_at: "2099-01-02T00:00:00.000Z",
      metadata,
      entropy: `claim-${taskId}`,
    });
    if (claim.outcome !== "acquired") {
      throw new Error(`Expected runtime claim for ${taskId}.`);
    }
    store.insertExecutionLogEntry({
      schema_version: RUNTIME_SCHEMA_VERSION,
      claim_token: claim.claimToken,
      target_type: "task",
      target_id: taskId,
      state: "completed",
      reason: "success",
      created_at: "2099-01-01T01:00:00.000Z",
      detail: { code: "x-runtime-completed" },
    });
  } finally {
    store.close();
  }
}

async function addLinkedWorktree(
  rootDir: string,
  branch: string,
): Promise<string> {
  const linkedWorktree = path.join(
    rootDir,
    "..",
    `${path.basename(rootDir)}-${branch.replace(/[^a-z0-9]+/gi, "-")}`,
  );
  git(rootDir, ["worktree", "add", "-b", branch, linkedWorktree]);
  temporaryDirectories.push(linkedWorktree);
  return linkedWorktree;
}

describe("task Git-context authority", () => {
  it("reads attached, detached, nested, linked, and non-repository contexts", async () => {
    const rootDir = await createGitFixture();
    const nestedDir = path.join(rootDir, "nested", "child");
    await fs.mkdir(nestedDir, { recursive: true });
    git(rootDir, ["switch", "-c", "sandcastle/issue-101"]);

    const attached = await readTaskAuthorityGitContext(nestedDir);
    expect(attached).toMatchObject({
      rootDir,
      branch: { state: "attached", name: "sandcastle/issue-101" },
    });
    expect(resolveGitRoot(nestedDir)).toBe(rootDir);
    expect(
      resolveTaskAuthorityFromGitContext(
        {
          rootDir: attached.rootDir,
          taskId: "wi-101",
          runtimeBranch: "sandcastle/issue-101",
        },
        attached,
      ),
    ).toMatchObject({ source: "current-root", rootDir });

    const linkedWorktree = path.join(
      rootDir,
      "..",
      `${path.basename(rootDir)}-linked`,
    );
    git(rootDir, [
      "worktree",
      "add",
      "-b",
      "sandcastle/issue-102",
      linkedWorktree,
    ]);
    temporaryDirectories.push(linkedWorktree);
    const linked = await readTaskAuthorityGitContext(linkedWorktree);
    expect(linked).toMatchObject({
      rootDir: linkedWorktree,
      branch: { state: "attached", name: "sandcastle/issue-102" },
    });
    expect(linked.worktrees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: rootDir,
          branch: "sandcastle/issue-101",
        }),
        expect.objectContaining({
          path: linkedWorktree,
          branch: "sandcastle/issue-102",
        }),
      ]),
    );
    expect(
      resolveTaskAuthorityFromGitContext(
        {
          rootDir,
          taskId: "wi-102",
          runtimeBranch: "sandcastle/issue-102",
        },
        await readTaskAuthorityGitContext(rootDir),
      ),
    ).toMatchObject({
      source: "current-root",
      rootDir,
      branch: "sandcastle/issue-101",
    });

    const detachedOid = git(linkedWorktree, ["rev-parse", "HEAD"]);
    git(linkedWorktree, ["checkout", "--detach", detachedOid]);
    const detached = await readTaskAuthorityGitContext(linkedWorktree);
    expect(detached.branch).toEqual({ state: "detached" });
    expect(
      resolveTaskAuthorityFromGitContext(
        {
          rootDir: detached.rootDir,
          taskId: "wi-102",
          runtimeBranch: "sandcastle/issue-102",
        },
        detached,
      ),
    ).toMatchObject({ source: "current-root", rootDir: linkedWorktree });

    const nonRepository = await fs.mkdtemp(
      path.join(os.tmpdir(), "doc-vader-not-a-repository-"),
    );
    temporaryDirectories.push(nonRepository);
    expect(await readTaskAuthorityGitContext(nonRepository)).toEqual({
      rootDir: nonRepository,
      worktrees: [],
    });
  });

  it("reads the same immutable local facts through the LibGit2 adapter", async () => {
    const rootDir = await createGitFixture();
    const nestedDir = path.join(rootDir, "nested", "child");
    await fs.mkdir(nestedDir, { recursive: true });
    git(rootDir, ["switch", "-c", "sandcastle/issue-111"]);
    const linkedWorktree = await addLinkedWorktree(rootDir, "sandcastle/issue-112");

    const context = await esGitWorkItemRepositoryWorktreeContextReader.read({
      rootDir: nestedDir,
    });

    expect(context).toMatchObject({
      rootDir,
      branch: { state: "attached", name: "sandcastle/issue-111" },
    });
    expect(context.worktrees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: rootDir, branch: "sandcastle/issue-111" }),
        expect.objectContaining({
          path: linkedWorktree,
          branch: "sandcastle/issue-112",
        }),
      ]),
    );
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.worktrees)).toBe(true);

    const detachedOid = git(rootDir, ["rev-parse", "HEAD"]);
    git(rootDir, ["checkout", "--detach", detachedOid]);
    expect(
      await esGitWorkItemRepositoryWorktreeContextReader.read({ rootDir }),
    ).toMatchObject({
      rootDir,
      branch: { state: "detached" },
    });

    const nonRepository = await fs.mkdtemp(
      path.join(os.tmpdir(), "doc-vader-es-git-not-a-repository-"),
    );
    temporaryDirectories.push(nonRepository);
    expect(
      await esGitWorkItemRepositoryWorktreeContextReader.read({
        rootDir: nonRepository,
      }),
    ).toEqual({ rootDir: nonRepository, worktrees: [] });
  });

  it("uses the LibGit2 reader by default and traces no Git CLI subprocesses", async () => {
    const rootDir = await createGitFixture();
    const defaultTrace = createTaskAuthorityTrace();
    const cliTrace = createTaskAuthorityTrace();

    expect(defaultWorkItemRepositoryWorktreeContextReader).toBe(
      esGitWorkItemRepositoryWorktreeContextReader,
    );
    await readTaskAuthorityGitContext(rootDir, defaultTrace);
    await cliWorkItemRepositoryWorktreeContextReader.read({ rootDir, trace: cliTrace });

    for (const stage of ["gitRoot", "gitCurrentBranch", "gitWorktreeList"] as const) {
      expect(defaultTrace.stages[stage].invocationCount).toBe(1);
      expect(defaultTrace.stages[stage].subprocessInvocationCount).toBe(0);
      expect(cliTrace.stages[stage].subprocessInvocationCount).toBe(1);
    }
  });

  it("accepts an equivalent symlinked runtime worktree path", async () => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "doc-vader-task-authority-symlink-"),
    );
    temporaryDirectories.push(rootDir);
    const worktreePath = path.join(rootDir, "worktree");
    const aliasPath = path.join(rootDir, "worktree-alias");
    await fs.mkdir(worktreePath);
    await fs.symlink(worktreePath, aliasPath);
    const canonicalWorktreePath = await fs.realpath(worktreePath);

    expect(
      resolveTaskAuthorityFromGitContext(
        {
          rootDir: canonicalWorktreePath,
          runtimeWorktree: aliasPath,
        },
        {
          rootDir: canonicalWorktreePath,
          worktrees: [
            {
              path: canonicalWorktreePath,
              branch: "sandcastle/issue-symlink",
            },
          ],
        },
      ),
    ).toEqual({
      rootDir: canonicalWorktreePath,
      source: "runtime-worktree",
      branch: "sandcastle/issue-symlink",
    });
  });

  it("does not use branch or task ID as a worktree locator", () => {
    const rootDir = path.resolve("/agent/current");
    const context = {
      branch: { state: "attached", name: "main" },
      worktrees: [
        { path: path.resolve("/agent/one"), branch: "sandcastle/issue-103" },
        { path: path.resolve("/agent/two"), branch: "sandcastle/issue-103" },
        {
          path: path.resolve("/agent/runtime-worktree"),
          branch: "sandcastle/issue-runtime-live",
        },
      ],
    };

    expect(
      resolveTaskAuthorityFromGitContext(
        {
          rootDir,
          taskId: "wi-103",
          runtimeBranch: "sandcastle/issue-103",
        },
        context,
      ),
    ).toEqual({ rootDir, source: "current-root", branch: "main" });
    expect(
      resolveTaskAuthorityFromGitContext(
        { rootDir, taskId: "wi-103" },
        {
          branch: { state: "attached", name: "main" },
          worktrees: [
            {
              path: path.resolve("/agent/legacy-task-id-branch"),
              branch: "sandcastle/issue-103",
            },
          ],
        },
      ),
    ).toEqual({ rootDir, source: "current-root", branch: "main" });
    expect(
      resolveTaskAuthorityFromGitContext(
        {
          rootDir,
          taskId: "wi-103",
          runtimeBranch: "sandcastle/issue-stale-metadata",
          runtimeWorktree: "/agent/runtime-worktree",
        },
        context,
      ),
    ).toEqual({
      rootDir: path.resolve("/agent/runtime-worktree"),
      source: "runtime-worktree",
      branch: "sandcastle/issue-runtime-live",
    });
  });

  it("reads Git context once per ready selection while resolving policy per task", async () => {
    const rootDir = await createGitFixture();
    await writeReadyTask(rootDir, "wi-104");
    await writeReadyTask(rootDir, "wi-105");
    const trace = createTaskAuthorityTrace();

    const selection = await selectReadyTasks({ rootDir, authorityTrace: trace });

    expect(selection.candidates.map((candidate) => candidate.id)).toEqual([
      "wi-104",
      "wi-105",
    ]);
    expect(trace.stages.gitRoot.invocationCount).toBe(1);
    expect(trace.stages.gitCurrentBranch.invocationCount).toBe(1);
    expect(trace.stages.gitWorktreeList.invocationCount).toBe(1);
    expect(trace.stages.policyResolution.invocationCount).toBe(2);
  });

  it("uses a valid linked runtime worktree document instead of the caller document", async () => {
    const rootDir = await createGitFixture();
    await writeReadyTask(rootDir, "wi-106", { title: "Caller document" });
    git(rootDir, ["add", "."]);
    git(rootDir, ["commit", "-m", "add task"]);
    const linkedWorktree = await addLinkedWorktree(rootDir, "sandcastle/issue-106");
    await writeReadyTask(linkedWorktree, "wi-106", {
      title: "Linked document",
      status: "in-progress",
    });
    recordCompletedExecution(rootDir, "wi-106", { worktree: linkedWorktree });

    const selection = await selectReadyTasks({ rootDir });

    expect(selection.candidates).toEqual([]);
    expect(selection.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "wi-106",
          title: "Linked document",
          reasons: expect.arrayContaining([
            expect.objectContaining({ code: "not_ready" }),
          ]),
        }),
      ]),
    );
  });

  it("uses an exact registered runtime worktree", async () => {
    const rootDir = await createGitFixture();
    await writeReadyTask(rootDir, "wi-107", {
      title: "Caller document",
      status: "in-progress",
    });
    git(rootDir, ["add", "."]);
    git(rootDir, ["commit", "-m", "add task"]);
    const linkedWorktree = await addLinkedWorktree(rootDir, "sandcastle/issue-107");
    await writeReadyTask(linkedWorktree, "wi-107", { title: "Nested linked document" });
    recordCompletedExecution(rootDir, "wi-107", { worktree: linkedWorktree });

    const selection = await selectReadyTasks({ rootDir });

    expect(selection.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "wi-107",
          title: "Nested linked document",
          reasons: expect.not.arrayContaining([
            expect.objectContaining({ code: "not_ready" }),
          ]),
        }),
      ]),
    );
  });

  it("fails closed when runtime worktree metadata is stale, nonexistent, or invalid", async () => {
    const rootDir = await createGitFixture();
    await writeReadyTask(rootDir, "wi-108", { title: "Stale worktree" });
    await writeReadyTask(rootDir, "wi-109", { title: "Invalid worktree" });
    recordCompletedExecution(rootDir, "wi-108", {
      worktree: path.join(rootDir, "removed-worktree"),
    });
    recordCompletedExecution(rootDir, "wi-109", { worktree: "" });

    const selection = await selectReadyTasks({ rootDir });

    expect(selection.candidates).toEqual([]);
    expect(selection.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "wi-108",
          reasons: expect.arrayContaining([
            expect.objectContaining({
              code: "execution_not_ready",
              message: "Execution metadata worktree is unavailable.",
            }),
          ]),
        }),
        expect.objectContaining({
          id: "wi-109",
          reasons: expect.arrayContaining([
            expect.objectContaining({
              code: "execution_not_ready",
              message: "Execution metadata worktree is unavailable.",
            }),
          ]),
        }),
      ]),
    );
  });

  it("fails closed when the selected runtime worktree lacks the task document", async () => {
    const rootDir = await createGitFixture();
    await writeReadyTask(rootDir, "wi-110", { title: "Caller-only document" });
    git(rootDir, ["add", "."]);
    git(rootDir, ["commit", "-m", "add task"]);
    const linkedWorktree = await addLinkedWorktree(rootDir, "sandcastle/issue-110");
    await fs.rm(path.join(linkedWorktree, "backlog", "wi-110.md"));
    recordCompletedExecution(rootDir, "wi-110", { worktree: linkedWorktree });

    const selection = await selectReadyTasks({ rootDir });

    expect(selection.candidates).toEqual([]);
    expect(selection.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "wi-110",
          title: "Caller-only document",
          reasons: expect.arrayContaining([
            expect.objectContaining({
              code: "execution_not_ready",
              message: "Execution metadata worktree is unavailable.",
            }),
          ]),
        }),
      ]),
    );
  });
});
