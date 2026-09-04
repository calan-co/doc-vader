import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createRuntimeClaimCoverageAuditTrace,
  openRuntimeSqliteStore,
  RUNTIME_SCHEMA_VERSION,
} from "../lib/runtime/index.js";
import { runRuntimeClaimCoverageAudit } from "../lib/work-management/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createRoot(): Promise<string> {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "doc-vader-runtime-claim-coverage-trace-"),
  );
  tempDirs.push(rootDir);
  return rootDir;
}

function runGit(rootDir: string, args: string[]): void {
  execFileSync("git", args, { cwd: rootDir, stdio: "ignore" });
}

async function createFeatureAuditFixture(): Promise<{
  rootDir: string;
  claimToken: string;
}> {
  const rootDir = await createRoot();
  runGit(rootDir, ["init", "--initial-branch", "main"]);
  runGit(rootDir, ["config", "user.email", "audit-trace@example.com"]);
  runGit(rootDir, ["config", "user.name", "Audit Trace"]);
  await fs.mkdir(path.join(rootDir, "backlog"), { recursive: true });
  await fs.writeFile(path.join(rootDir, "backlog", "locked.md"), "base\n");
  await fs.writeFile(path.join(rootDir, "backlog", "unlocked.md"), "base\n");
  runGit(rootDir, ["add", "."]);
  runGit(rootDir, ["commit", "-m", "chore: base"]);
  runGit(rootDir, ["switch", "-c", "feature/audit-trace"]);
  await fs.appendFile(path.join(rootDir, "backlog", "locked.md"), "feature\n");
  await fs.appendFile(path.join(rootDir, "backlog", "unlocked.md"), "feature\n");
  runGit(rootDir, ["add", "."]);
  runGit(rootDir, ["commit", "-m", "feat: changed files"]);

  const store = openRuntimeSqliteStore({ rootDir });
  try {
    const acquired = store.acquireRuntimeClaim(
      {
        schema_version: RUNTIME_SCHEMA_VERSION,
        target_type: "task",
        target_id: "wi-audit-trace",
        holder: "test",
        created_at: "2099-01-01T00:00:00.000Z",
        expires_at: "2099-01-01T04:00:00.000Z",
        entropy: "audit-trace",
      },
      { initialLockPaths: ["backlog/locked.md"] },
    );
    if (acquired.outcome !== "acquired") {
      throw new Error("Expected runtime claim acquisition.");
    }
    return { rootDir, claimToken: acquired.claimToken };
  } finally {
    store.close();
  }
}

describe("runtime claim coverage audit tracing", () => {
  it("uses the default LibGit2 snapshot and traces reduced direct Git subprocess cost end-to-end", async () => {
    const { rootDir, claimToken } = await createFeatureAuditFixture();
    const trace = createRuntimeClaimCoverageAuditTrace();

    const audit = await runRuntimeClaimCoverageAudit({
      rootDir,
      taskId: "wi-audit-trace",
      claimToken,
      requiredPaths: ["backlog/locked.md"],
      fullAuditTrace: trace,
    });

    expect(audit).toMatchObject({
      passed: false,
      fresh: true,
      mergeable: true,
      changedPaths: expect.arrayContaining([
        "backlog/locked.md",
        "backlog/unlocked.md",
      ]),
    });
    expect(trace.operationOnlyMs).toBeGreaterThanOrEqual(0);
    expect(trace.directGitSubprocess).toEqual(
      expect.objectContaining({ invocationCount: 3 }),
    );
    expect(trace.directGitSubprocess.durationMs).toBeGreaterThanOrEqual(0);
    expect(trace.stages.fullAudit.invocationCount).toBe(1);
    expect(trace.stages.mergeTargetResolution.invocationCount).toBe(1);
    expect(trace.stages.gitMergeTargetProbe.invocationCount).toBe(1);
    expect(trace.stages.gitChangedFilesHeadRef.invocationCount).toBe(1);
    expect(trace.stages.gitChangedFilesHead.invocationCount).toBe(1);
    expect(trace.stages.gitChangedFilesMergeTarget.invocationCount).toBe(1);
    expect(trace.stages.gitChangedFilesMergeBase.invocationCount).toBe(1);
    expect(trace.stages.gitChangedFilesMergeTree.invocationCount).toBe(1);
    expect(trace.stages.gitChangedFilesBranchDiff.invocationCount).toBe(1);
    expect(trace.stages.gitChangedFilesWorktreeDiff.invocationCount).toBe(1);
    expect(trace.stages.gitChangedFilesUntracked.invocationCount).toBe(1);
    expect(trace.stages.gitRequiredPathsHeadRef.invocationCount).toBe(1);
    expect(trace.stages.gitRequiredPathsHead.invocationCount).toBe(1);
    expect(
      Object.values(trace.outcomes).reduce(
        (count, outcome) => count + outcome.value + outcome.undefined,
        0,
      ),
    ).toBe(11);
    expect(trace.stages.gitChangedFileParsing.invocationCount).toBe(3);
    expect(trace.stages.gitChangedFileMerge.invocationCount).toBe(2);
    expect(trace.stages.gitRenameDetection.invocationCount).toBe(1);
    expect(trace.stages.scopeLockLookup.invocationCount).toBe(3);
    expect(trace.lockLookups).toEqual({
      "backlog/locked.md": expect.objectContaining({ invocationCount: 2 }),
      "backlog/unlocked.md": expect.objectContaining({ invocationCount: 1 }),
    });
    expect(
      Object.values(trace.stages)
        .filter((timing) => timing.invocationCount > 0)
        .every((timing) => timing.durationMs >= 0),
    ).toBe(true);
  }, 10_000);

  it("keeps swallowed full-audit Git CLI failures observable through trace outcomes", async () => {
    const rootDir = await createRoot();
    const store = openRuntimeSqliteStore({ rootDir });
    let claimToken: string;
    try {
      const acquired = store.acquireRuntimeClaim(
        {
          schema_version: RUNTIME_SCHEMA_VERSION,
          target_type: "task",
          target_id: "wi-no-git-audit-trace",
          holder: "test",
          created_at: "2099-01-01T00:00:00.000Z",
          expires_at: "2099-01-01T04:00:00.000Z",
          entropy: "no-git-audit-trace",
        },
        { initialLockPaths: ["backlog/owned.md"] },
      );
      if (acquired.outcome !== "acquired") {
        throw new Error("Expected runtime claim acquisition.");
      }
      claimToken = acquired.claimToken;
    } finally {
      store.close();
    }

    const trace = createRuntimeClaimCoverageAuditTrace();
    const audit = await runRuntimeClaimCoverageAudit({
      rootDir,
      taskId: "wi-no-git-audit-trace",
      claimToken,
      requiredPaths: ["backlog/owned.md"],
      fullAuditTrace: trace,
    });

    expect(audit).toMatchObject({ passed: true, fresh: true, mergeable: true });
    expect(trace.stages.mergeTargetResolution.invocationCount).toBe(1);
    expect(trace.stages.gitMergeTargetProbe.invocationCount).toBe(3);
    expect(trace.stages.gitChangedFilesHeadRef.invocationCount).toBe(1);
    expect(trace.stages.gitChangedFilesHead.invocationCount).toBe(1);
    expect(trace.stages.gitChangedFilesMergeTarget.invocationCount).toBe(1);
    expect(trace.stages.gitChangedFilesMergeBase.invocationCount).toBe(0);
    expect(trace.stages.gitChangedFilesMergeTree.invocationCount).toBe(0);
    expect(trace.stages.gitChangedFilesBranchDiff.invocationCount).toBe(1);
    expect(trace.stages.gitChangedFilesWorktreeDiff.invocationCount).toBe(1);
    expect(trace.stages.gitChangedFilesUntracked.invocationCount).toBe(1);
    expect(trace.stages.gitRequiredPathsHeadRef.invocationCount).toBe(1);
    expect(trace.stages.gitRequiredPathsHead.invocationCount).toBe(1);
    expect(trace.outcomes.gitMergeTargetProbe.undefined).toBe(3);
    expect(trace.outcomes.gitChangedFilesHeadRef.undefined).toBe(1);
    expect(trace.outcomes.gitChangedFilesHead.undefined).toBe(1);
    expect(trace.lockLookups["backlog/owned.md"]?.invocationCount).toBe(1);
  });
});
