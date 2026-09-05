import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditClaimAuthorityClaimedPaths } from "../lib/claim/index.js";
import {
  cliClaimedPathGitAuditAdapter,
  esGitClaimedPathGitAuditAdapter,
  type ClaimedPathGitAuditAdapter,
} from "../lib/runtime/git-audit-adapter.js";
import {
  openRuntimeSqliteStore,
  RUNTIME_SCHEMA_VERSION,
} from "../lib/runtime/sqlite-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0, temporaryDirectories.length).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createRepository(): Promise<string> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-git-audit-"));
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
  await fs.writeFile(path.join(rootDir, "README.md"), "base\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: rootDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "chore: base"], {
    cwd: rootDir,
    stdio: "ignore",
  });
  return rootDir;
}

function headOid(rootDir: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: rootDir,
    encoding: "utf8",
  }).trim();
}

const adapters: Array<[string, ClaimedPathGitAuditAdapter]> = [
  ["Git CLI", cliClaimedPathGitAuditAdapter],
  ["es-git", esGitClaimedPathGitAuditAdapter],
];

describe("claimed-path Git audit adapters", () => {
  for (const [name, adapter] of adapters) {
    it(`${name} reads an attached branch`, async () => {
      const rootDir = await createRepository();

      await expect(adapter.readMetadata(rootDir)).resolves.toEqual({
        branch: "main",
        detached: false,
        headOid: headOid(rootDir),
      });
    });

    it(`${name} reads metadata from a linked worktree`, async () => {
      const rootDir = await createRepository();
      const worktreeDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "doc-vader-git-audit-worktree-"),
      );
      temporaryDirectories.push(worktreeDir);
      execFileSync(
        "git",
        ["worktree", "add", "-b", "feature/linked-audit", worktreeDir],
        { cwd: rootDir, stdio: "ignore" },
      );

      await expect(adapter.readMetadata(worktreeDir)).resolves.toEqual({
        branch: "feature/linked-audit",
        detached: false,
        headOid: headOid(worktreeDir),
      });
    });

    it(`${name} reads a detached HEAD`, async () => {
      const rootDir = await createRepository();
      const oid = headOid(rootDir);
      execFileSync("git", ["checkout", "--detach", oid], {
        cwd: rootDir,
        stdio: "ignore",
      });

      await expect(adapter.readMetadata(rootDir)).resolves.toEqual({
        detached: true,
        headOid: oid,
      });
    });
  }

  it.each(adapters)("%s fails closed when repository metadata cannot be read", async (_name, adapter) => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "doc-vader-git-audit-unavailable-"),
    );
    temporaryDirectories.push(rootDir);

    await expect(adapter.readMetadata(rootDir)).rejects.toThrow(
      "claimed-path Git metadata",
    );
  });

  it("routes claimed-path audits through the injected adapter without changing lock diagnostics", async () => {
    const rootDir = await createRepository();
    const store = openRuntimeSqliteStore({ rootDir });
    const claimToken = `claim-${randomUUID()}`;
    try {
      store.insertClaim({
        schema_version: RUNTIME_SCHEMA_VERSION,
        claim_token: claimToken,
        target_type: "task",
        target_id: "wi-audit-adapter",
        holder: "agent-a",
        created_at: "2026-06-15T12:00:00.000Z",
        expires_at: "2099-06-15T12:00:00.000Z",
      });
    } finally {
      store.close();
    }
    const adapter: ClaimedPathGitAuditAdapter = {
      readMetadata: vi.fn().mockResolvedValue({
        branch: "from-injected-adapter",
        detached: false,
        headOid: "injected-oid",
      }),
    };

    const audit = await auditClaimAuthorityClaimedPaths({
      rootDir,
      claimToken,
      requiredPaths: ["backlog/unlocked.md"],
      gitAuditAdapter: adapter,
    });

    expect(adapter.readMetadata).toHaveBeenCalledWith(rootDir);
    expect(audit).toMatchObject({
      headRef: "from-injected-adapter",
      headSha: "injected-oid",
      passed: false,
    });
    expect(audit.diagnostics).toEqual([
      expect.objectContaining({
        path: "backlog/unlocked.md",
        expectedClaimToken: claimToken,
        actualLockState: "missing",
      }),
    ]);
  });
});
