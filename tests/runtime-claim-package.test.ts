import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  openRuntimeSqliteStore,
  RUNTIME_SCHEMA_VERSION,
} from "../lib/runtime/index.js";
import {
  createRuntimeClaimCommandApi,
  RuntimeClaimAuthorityGatePolicy,
  RuntimeClaimSqliteDataAdapter,
  readRuntimeClaimProjection,
  readRuntimeClaimTaskExecutionSummaries,
  readRuntimeClaimTaskSnapshots,
} from "../lib/runtime-claim/index.js";
import { loadTaskExecutionLogSummaries } from "../lib/task/runtime.js";
import { projectWorkGraph } from "../lib/work/projection.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createRoot(): Promise<string> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-runtime-claim-package-"));
  tempDirs.push(rootDir);
  return rootDir;
}

function runGit(rootDir: string, args: string[]): void {
  execFileSync("git", args, { cwd: rootDir, stdio: "ignore" });
}

async function createGitWorktree(rootDir: string): Promise<string> {
  const worktreeRoot = `${rootDir}-worktree`;
  runGit(rootDir, ["init", "--initial-branch", "main"]);
  runGit(rootDir, ["config", "user.email", "runtime-claim@example.com"]);
  runGit(rootDir, ["config", "user.name", "Runtime Claim"]);
  await fs.mkdir(path.join(rootDir, "backlog"), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, "backlog", "60468-runtime-claim.md"),
    `---\nid: wi-60468\ntitle: Runtime Claim\ntype: work-item\nsubtype: task\nlifecycle: active\nstatus: ready\npriority: high\n---\n`,
    "utf8",
  );
  runGit(rootDir, ["add", "."]);
  runGit(rootDir, ["commit", "-m", "chore: establish runtime claim worktree"]);
  runGit(rootDir, ["worktree", "add", "-b", "runtime-claim-review", worktreeRoot]);
  return worktreeRoot;
}

describe("Runtime Claim package contribution", () => {
  it("projects SQLite-backed claim validity and lock compatibility without making claims Work Item qualifiers", async () => {
    const rootDir = await createRoot();
    const store = openRuntimeSqliteStore({ rootDir });
    let claimToken: string;
    try {
      const acquired = store.acquireRuntimeClaim(
        {
          schema_version: RUNTIME_SCHEMA_VERSION,
          target_type: "task",
          target_id: "wi-runtime-claim-package",
          holder: "test",
          created_at: "2099-01-01T00:00:00.000Z",
          expires_at: "2099-01-01T04:00:00.000Z",
          entropy: "runtime-claim-package",
        },
        { initialLockPaths: ["backlog/60468-runtime-claim-package-migration.md"] },
      );
      if (acquired.outcome !== "acquired") {
        throw new Error("Expected runtime claim acquisition.");
      }
      claimToken = acquired.claimToken;
    } finally {
      store.close();
    }

    const adapter = new RuntimeClaimSqliteDataAdapter({ rootDir });
    expect(adapter.projectQualifiers({
      targetType: "task",
      targetId: "wi-runtime-claim-package",
      claimToken,
      requiredPaths: ["backlog/60468-runtime-claim-package-migration.md"],
    })).toEqual([
      expect.objectContaining({ id: "runtime-claim-validity", status: "met" }),
      expect.objectContaining({ id: "runtime-lock-compatibility", status: "met" }),
    ]);

    const policy = new RuntimeClaimAuthorityGatePolicy();
    expect(policy.evaluate({
      rootDir,
      targetType: "task",
      targetId: "wi-runtime-claim-package",
      claimToken: "wrong-token",
      requiredPaths: ["backlog/60468-runtime-claim-package-migration.md"],
      authorizeClaim: true,
    })).toMatchObject({
      allowed: false,
      code: "WORK_MUTATION_CLAIM_REQUIRED",
    });
    expect(policy.evaluate({
      rootDir,
      targetType: "task",
      targetId: "wi-runtime-claim-package",
      claimToken,
      requiredPaths: ["backlog/uncovered.md"],
      authorizeClaim: true,
    })).toMatchObject({
      allowed: false,
      code: "WORK_MUTATION_CLAIM_COVERAGE_REQUIRED",
    });

    const absoluteLockedPath = path.join(
      rootDir,
      "backlog/60468-runtime-claim-package-migration.md",
    );
    const preflightedAudit = adapter.withStore((authority) =>
      authority.auditClaimedPaths(claimToken, [absoluteLockedPath]),
    );
    expect(policy.evaluate({
      rootDir,
      targetType: "task",
      targetId: "wi-runtime-claim-package",
      claimToken,
      requiredPaths: [absoluteLockedPath],
      claimedPathAudit: preflightedAudit,
      authorizeClaim: true,
    })).toMatchObject({ allowed: true });

    adapter.withStore((authority) => {
      authority.database
        .prepare("UPDATE claims SET expires_at = '2000-01-01T00:00:00.000Z' WHERE claim_token = ?")
        .run(claimToken);
    });
    expect(policy.evaluate({
      rootDir,
      targetType: "task",
      targetId: "wi-runtime-claim-package",
      claimToken,
      requiredPaths: [],
      authorizeClaim: true,
    })).toMatchObject({
      allowed: false,
      code: "RUNTIME_CLAIM_EXPIRED",
    });
  });

  it("owns claim and lock command operations through a package API", async () => {
    const rootDir = await createRoot();
    runGit(rootDir, ["init", "--initial-branch", "main"]);
    runGit(rootDir, ["config", "user.email", "runtime-claim@example.com"]);
    runGit(rootDir, ["config", "user.name", "Runtime Claim"]);
    const commands = createRuntimeClaimCommandApi({ rootDir });
    const acquired = commands.acquireClaim({
      schema_version: RUNTIME_SCHEMA_VERSION,
      target_type: "task",
      target_id: "wi-runtime-claim-command-api",
      holder: "package-command-test",
      created_at: "2099-01-01T00:00:00.000Z",
      expires_at: "2099-01-01T04:00:00.000Z",
      entropy: "runtime-claim-command-api",
    }, ["backlog/60468-runtime-claim-package-migration.md"]);
    expect(acquired).toMatchObject({ outcome: "acquired" });
    if (acquired.outcome !== "acquired") {
      throw new Error("Expected package command claim acquisition.");
    }

    expect(commands.getClaimStatus(acquired.claimToken)).toMatchObject({
      claim_token: acquired.claimToken,
      state: "active",
    });
    const renewed = commands.renewClaim(acquired.claimToken, {
      now: new Date("2099-01-01T01:00:00.000Z"),
      ttlMilliseconds: 60 * 60_000,
    });
    expect(renewed).toMatchObject({
      outcome: "renewed",
      claimToken: acquired.claimToken,
      claim: {
        claim_token: acquired.claimToken,
        expires_at: "2099-01-01T02:00:00.000Z",
      },
    });
    expect(readRuntimeClaimProjection({ rootDir }).claims).toContainEqual(
      expect.objectContaining({
        token: acquired.claimToken,
        expiresAt: "2099-01-01T02:00:00.000Z",
      }),
    );
    expect(commands.acquireLocks(acquired.claimToken, ["docs/runtime-claim.md"]))
      .toMatchObject({ outcome: "acquired" });
    expect(commands.getLockStatus(acquired.claimToken)).toMatchObject({
      state: "active",
      locks: expect.arrayContaining([expect.objectContaining({ path: "docs/runtime-claim.md" })]),
    });
    expect(commands.releaseClaim(acquired.claimToken)).toMatchObject({
      outcome: "released",
      claim: expect.objectContaining({ claim_token: acquired.claimToken }),
    });
    expect(commands.getClaimStatus(acquired.claimToken)).toBeUndefined();
  });

  it("keeps package projections and Work runtime facts visible across Git worktrees", async () => {
    const rootDir = await createRoot();
    const worktreeRoot = await createGitWorktree(rootDir);
    try {
      const adapter = new RuntimeClaimSqliteDataAdapter({ rootDir });
      const claimToken = adapter.withStore((store) => {
        const acquired = store.acquireRuntimeClaim(
          {
            schema_version: RUNTIME_SCHEMA_VERSION,
            target_type: "task",
            target_id: "wi-60468",
            holder: "runtime-claim-test",
            created_at: "2099-01-01T00:00:00.000Z",
            expires_at: "2099-01-01T04:00:00.000Z",
            entropy: "cross-worktree-runtime-claim-package",
          },
          { initialLockPaths: ["backlog/60468-runtime-claim.md"] },
        );
        if (acquired.outcome !== "acquired") {
          throw new Error("Expected runtime claim acquisition.");
        }
        return acquired.claimToken;
      });

      const state = readRuntimeClaimProjection({ rootDir: worktreeRoot });
      expect(state.claims).toEqual([
        expect.objectContaining({ token: claimToken, targetId: "wi-60468" }),
      ]);
      expect(state.scopeLocks).toEqual([
        expect.objectContaining({ claimToken, scopeRef: "wi:60468" }),
      ]);
      expect(readRuntimeClaimTaskSnapshots({
        rootDir: worktreeRoot,
        taskIds: ["wi-60468"],
      })).toEqual(new Map([
        ["wi-60468", expect.objectContaining({
          claim: expect.objectContaining({ token: claimToken }),
          activeScopeLocks: [expect.objectContaining({ scopeRef: "wi:60468" })],
        })],
      ]));
      expect(readRuntimeClaimTaskExecutionSummaries({
        rootDir: worktreeRoot,
        taskIds: ["wi-60468"],
      })).toEqual(new Map([
        ["wi-60468", expect.objectContaining({
          execution: expect.objectContaining({ claimToken, targetId: "wi-60468", state: "running" }),
          activeLockCount: 1,
        })],
      ]));

      const projection = await projectWorkGraph({ rootDir: worktreeRoot });
      expect(projection.findNode(`claim:${claimToken}`)).toBeDefined();
      expect(
        projection.getEdgesByType("locks").some((edge) =>
          edge.properties.claimToken === claimToken &&
          edge.properties.scopeRef === "wi:60468",
        ),
      ).toBe(true);
      expect(await loadTaskExecutionLogSummaries({
        rootDir: worktreeRoot,
        taskIds: ["wi-60468"],
      })).toEqual(new Map([
        ["wi-60468", expect.objectContaining({ claimToken, state: "running" })],
      ]));
    } finally {
      runGit(rootDir, ["worktree", "remove", "--force", worktreeRoot]);
      await fs.rm(worktreeRoot, { recursive: true, force: true });
    }
  });
});
