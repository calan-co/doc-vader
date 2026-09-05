import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  adoptExpiredClaimAuthorityClaimByToken,
  createCliExpiredTaskLineageGitAdapter,
  defaultExpiredTaskLineageGitAdapter,
  esGitExpiredTaskLineageGitAdapter,
  inspectExpiredTaskClaimLineage,
  releaseExpiredClaimAuthorityClaimByToken,
  type ExpiredTaskLineageGitAdapter,
} from "../lib/claim/index.js";
import { openRuntimeSqliteStore, RUNTIME_SCHEMA_VERSION } from "../lib/runtime/index.js";
import { getClaimStatus, recoverClaim } from "../lib/task/claims.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function git(rootDir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

async function createRepository(): Promise<{ rootDir: string; worktreeDir: string }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-claim-lineage-"));
  roots.push(rootDir);
  git(rootDir, ["init", "--initial-branch", "main"]);
  git(rootDir, ["config", "user.email", "claim-lineage@example.com"]);
  git(rootDir, ["config", "user.name", "Claim Lineage"]);
  await fs.writeFile(path.join(rootDir, "README.md"), "base\n");
  git(rootDir, ["add", "."]);
  git(rootDir, ["commit", "-m", "base"]);
  const worktreeDir = `${rootDir}-worktree`;
  roots.push(worktreeDir);
  git(rootDir, ["worktree", "add", "-b", "claim-lineage", worktreeDir]);
  const store = openRuntimeSqliteStore({ rootDir });
  store.close();
  return { rootDir, worktreeDir };
}

function addExpiredTaskClaim(options: {
  rootDir: string;
  token: string;
  metadata?: Record<string, unknown>;
  targetType?: string;
}): string {
  const store = openRuntimeSqliteStore({ rootDir: options.rootDir });
  try {
    const acquisition = store.acquireRuntimeClaim({
      schema_version: RUNTIME_SCHEMA_VERSION,
      target_type: options.targetType ?? "task",
      target_id: `wi-${options.token}`,
      holder: "agent",
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-01-01T01:00:00.000Z",
      ...(options.metadata ? { metadata: options.metadata } : {}),
      entropy: options.token,
    });
    if (acquisition.outcome !== "acquired") {
      throw new Error("Expected claim acquisition.");
    }
    store.database
      .prepare("UPDATE claims SET expires_at = '2000-01-01T00:00:00.000Z' WHERE claim_token = ?")
      .run(acquisition.claimToken);
    return acquisition.claimToken;
  } finally {
    store.close();
  }
}

describe("expired task Claim-pack lineage inspection", () => {
  it("uses the public Claim-pack query to inspect a registered linked worktree in its selected cwd", async () => {
    const { rootDir, worktreeDir } = await createRepository();
    await fs.writeFile(path.join(worktreeDir, "README.md"), "base\nwork\n");
    git(worktreeDir, ["add", "README.md"]);
    git(worktreeDir, ["commit", "-m", "work"]);
    const tracePath = path.join(rootDir, "git-cwds.log");
    const executable = path.join(rootDir, "git-recorder");
    const systemGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    await fs.writeFile(
      executable,
      `#!/bin/sh\npwd >> "${tracePath}"\nexec "${systemGit}" "$@"\n`,
      { mode: 0o755 },
    );
    const claimToken = addExpiredTaskClaim({
      rootDir,
      token: "linked",
      metadata: { worktree: worktreeDir, branch: "claim-lineage", baseRef: "main" },
    });

    await expect(
      inspectExpiredTaskClaimLineage({
        rootDir,
        claimToken,
        gitAdapter: createCliExpiredTaskLineageGitAdapter({ gitExecutable: executable }),
      }),
    ).resolves.toMatchObject({
      outcome: "authoritative",
      classification: "adopt_recommended",
      git: { worktreePath: worktreeDir, branch: "claim-lineage", baseRef: "main", aheadCount: 1 },
      gitInspectionCount: 1,
    });
    const cwds = (await fs.readFile(tracePath, "utf8")).trim().split("\n");
    expect(cwds).toEqual(expect.arrayContaining([await fs.realpath(worktreeDir)]));
    expect(cwds).not.toContain(await fs.realpath(rootDir));
  });

  it("defaults to es-git for registered linked-worktree lineage without a CLI selector", async () => {
    const { rootDir, worktreeDir } = await createRepository();
    const claimToken = addExpiredTaskClaim({
      rootDir,
      token: "default-es-git-linked",
      metadata: { worktree: worktreeDir, branch: "claim-lineage", baseRef: "main" },
    });

    expect(defaultExpiredTaskLineageGitAdapter).toBe(esGitExpiredTaskLineageGitAdapter);
    await expect(
      inspectExpiredTaskClaimLineage({ rootDir, claimToken }),
    ).resolves.toMatchObject({
      outcome: "authoritative",
      classification: "release_safe",
      git: { worktreePath: worktreeDir, aheadCount: 0 },
      gitInspectionCount: 1,
    });
  });

  it("avoids the eight fixed CLI reads when the default inspects linked-worktree lineage", async () => {
    const { rootDir, worktreeDir } = await createRepository();
    const claimToken = addExpiredTaskClaim({
      rootDir,
      token: "default-es-git-trace",
      metadata: { worktree: worktreeDir, branch: "claim-lineage", baseRef: "main" },
    });
    const tracePath = path.join(rootDir, "git-invocations.log");
    const gitExecutable = path.join(rootDir, "git");
    const systemGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    await fs.writeFile(
      gitExecutable,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(tracePath)}\nexec ${JSON.stringify(systemGit)} "$@"\n`,
      { encoding: "utf8", mode: 0o755 },
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${rootDir}${path.delimiter}${previousPath ?? ""}`;
    try {
      await inspectExpiredTaskClaimLineage({
        rootDir,
        claimToken,
        gitAdapter: createCliExpiredTaskLineageGitAdapter({ gitExecutable }),
      });
      const cliInvocationCount = (await fs.readFile(tracePath, "utf8"))
        .split("\n")
        .filter(Boolean).length;

      await expect(inspectExpiredTaskClaimLineage({ rootDir, claimToken })).resolves.toMatchObject({
        outcome: "authoritative",
        classification: "release_safe",
        git: { worktreePath: worktreeDir, aheadCount: 0 },
      });
      const defaultInvocationCount = (await fs.readFile(tracePath, "utf8"))
        .split("\n")
        .filter(Boolean).length - cliInvocationCount;

      // Claim authority resolution retains its two fixed Git reads; the
      // default eliminates the lineage adapter's eight CLI subprocesses.
      expect(cliInvocationCount).toBe(10);
      expect(defaultInvocationCount).toBe(2);
      expect(cliInvocationCount - defaultInvocationCount).toBe(8);
    } finally {
      if (previousPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = previousPath;
      }
    }
  });

  it("uses authoritative runtime lineage for task recovery despite a forged local claim projection", async () => {
    const { rootDir, worktreeDir } = await createRepository();
    const claimToken = addExpiredTaskClaim({
      rootDir,
      token: "task-recovery",
      metadata: { worktree: worktreeDir, branch: "claim-lineage", baseRef: "main" },
    });
    const localPath = path.join(rootDir, ".doc-vader", "runtime", "task-claims");
    await fs.writeFile(
      localPath,
      JSON.stringify({ claims: [{ id: claimToken, taskId: "forged", holder: "forged", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", branch: "forged" }] }),
    );

    await expect(recoverClaim(claimToken, { rootDir })).resolves.toMatchObject({
      taskId: "wi-task-recovery",
      state: "expired",
      classification: "release_safe",
      reasons: ["expired_claim_branch_has_no_unique_commits"],
    });
    await expect(recoverClaim(claimToken, { rootDir, action: "release" })).resolves.toMatchObject({
      taskId: "wi-task-recovery",
      state: "released",
      classification: "terminal",
    });
    await expect(getClaimStatus(claimToken, { rootDir })).resolves.toMatchObject({ state: "missing" });
  }, 15_000);

  it("does not release an expired lineage claim that was adopted before conditional recovery release", async () => {
    const { rootDir, worktreeDir } = await createRepository();
    const claimToken = addExpiredTaskClaim({
      rootDir,
      token: "conditional-release-race",
      metadata: { worktree: worktreeDir, branch: "claim-lineage", baseRef: "main" },
    });

    const lineage = await inspectExpiredTaskClaimLineage({ rootDir, claimToken });
    expect(lineage).toMatchObject({
      outcome: "authoritative",
      classification: "release_safe",
      claimToken,
    });
    if (lineage.outcome !== "authoritative") {
      throw new Error("Expected an authoritative lineage inspection.");
    }

    expect(
      adoptExpiredClaimAuthorityClaimByToken({ rootDir, claimToken }),
    ).toMatchObject({ outcome: "adopted", claim: { claim_token: claimToken } });
    expect(
      releaseExpiredClaimAuthorityClaimByToken({
        rootDir,
        claimToken,
        expectedExpiresAt: lineage.claimExpiresAt,
      }),
    ).toMatchObject({ outcome: "condition-not-met", claim: { claim_token: claimToken, state: "active" } });
    await expect(getClaimStatus(claimToken, { rootDir })).resolves.toMatchObject({
      claimId: claimToken,
      state: "active",
    });
  });

  it("fails closed when a Claim is adopted after the release-safe inspection but before recovery release", async () => {
    const { rootDir, worktreeDir } = await createRepository();
    const claimToken = addExpiredTaskClaim({
      rootDir,
      token: "recovery-release-race",
      metadata: { worktree: worktreeDir, branch: "claim-lineage", baseRef: "main" },
    });
    let adopted = false;

    await expect(
      recoverClaim(claimToken, {
        rootDir,
        action: "release",
        lineageTrace: {
          record(stage) {
            if (stage !== "git-inspection" || adopted) {
              return;
            }
            adopted = true;
            expect(
              adoptExpiredClaimAuthorityClaimByToken({ rootDir, claimToken }),
            ).toMatchObject({ outcome: "adopted", claim: { claim_token: claimToken } });
          },
        },
      }),
    ).rejects.toMatchObject({ code: "TASK_RECOVERY_UNSAFE_RELEASE" });
    expect(adopted).toBe(true);
    await expect(getClaimStatus(claimToken, { rootDir })).resolves.toMatchObject({
      claimId: claimToken,
      state: "active",
    });
  });

  it.each([
    ["missing worktree", undefined, "worktree_missing"],
    ["non-Git worktree", "non-git", "worktree_not_git"],
    ["unregistered worktree path", "unregistered", "worktree_not_registered"],
    ["unrelated Git repository", "unrelated", "worktree_authority_mismatch"],
  ] as const)("fails closed for %s", async (_name, kind, reason) => {
    const { rootDir } = await createRepository();
    let worktree: string | undefined;
    if (kind === "non-git") {
      worktree = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-not-git-"));
      roots.push(worktree);
    }
    if (kind === "unregistered") {
      worktree = path.join(rootDir, "nested");
      await fs.mkdir(worktree);
    }
    if (kind === "unrelated") {
      worktree = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-unrelated-"));
      roots.push(worktree);
      git(worktree, ["init", "--initial-branch", "other"]);
    }
    const claimToken = addExpiredTaskClaim({
      rootDir,
      token: `invalid-${reason}`,
      metadata: { worktree: worktree ?? path.join(rootDir, "missing"), branch: "claim-lineage", baseRef: "main" },
    });

    await expect(inspectExpiredTaskClaimLineage({ rootDir, claimToken })).resolves.toMatchObject({
      outcome: "manual_review_required",
      reason,
      gitInspectionCount: 1,
    });
  });

  it("fails closed for detached HEAD, mismatched branch, missing base, and adapter errors", async () => {
    const { rootDir, worktreeDir } = await createRepository();
    const detachedToken = addExpiredTaskClaim({ rootDir, token: "detached", metadata: { worktree: worktreeDir, branch: "claim-lineage", baseRef: "main" } });
    const branchToken = addExpiredTaskClaim({ rootDir, token: "branch", metadata: { worktree: worktreeDir, branch: "other", baseRef: "main" } });
    const baseToken = addExpiredTaskClaim({ rootDir, token: "base", metadata: { worktree: worktreeDir, branch: "claim-lineage", baseRef: "missing" } });
    const errorToken = addExpiredTaskClaim({ rootDir, token: "error", metadata: { worktree: worktreeDir, branch: "claim-lineage", baseRef: "main" } });
    const failingAdapter: ExpiredTaskLineageGitAdapter = { async inspect() { throw new Error("injected adapter error"); } };

    git(worktreeDir, ["checkout", "--detach"]);
    await expect(inspectExpiredTaskClaimLineage({ rootDir, claimToken: detachedToken })).resolves.toMatchObject({ reason: "detached" });
    git(worktreeDir, ["switch", "claim-lineage"]);
    await expect(inspectExpiredTaskClaimLineage({ rootDir, claimToken: branchToken })).resolves.toMatchObject({ reason: "branch_unavailable" });
    await expect(inspectExpiredTaskClaimLineage({ rootDir, claimToken: baseToken })).resolves.toMatchObject({ reason: "base_unavailable" });
    await expect(inspectExpiredTaskClaimLineage({ rootDir, claimToken: errorToken, gitAdapter: failingAdapter })).resolves.toMatchObject({ reason: "git_error" });
  }, 15_000);
});
