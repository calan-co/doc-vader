import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openRuntimeSqliteStore } from "../lib/runtime/sqlite-store.js";

const tempDirs: string[] = [];
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const cliPath = path.resolve(__dirname, "../cli/doc-vader.ts");

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) =>
      fs.rm(dir, { recursive: true, force: true }),
    ),
  );
});

async function mkRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-lock-"));
  tempDirs.push(root);
  return root;
}

async function initGitRepo(root: string): Promise<void> {
  execFileSync("git", ["init", "--initial-branch", "main"], {
    cwd: root,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.email", "agent@example.com"], {
    cwd: root,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Agent"], {
    cwd: root,
    stdio: "ignore",
  });
}

function runCli(root: string, args: string[]): string {
  return execFileSync("node", ["--import", tsxImport, cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

describe.sequential("lock command surface", () => {
  it("creates, reports, and removes claim-owned locks through the CLI", { timeout: 15_000 }, async () => {
    const root = await mkRoot();
    await initGitRepo(root);
    await fs.mkdir(path.join(root, "backlog"), { recursive: true });
    await fs.writeFile(path.join(root, "backlog", "clean.md"), "clean\n", "utf8");
    await fs.writeFile(path.join(root, "backlog", "dirty.md"), "dirty\n", "utf8");
    execFileSync("git", ["add", "backlog/clean.md", "backlog/dirty.md"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "chore: base files"], {
      cwd: root,
      stdio: "ignore",
    });

    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const claim = store.acquireRuntimeClaim({
        schema_version: "runtime-entity/v1",
        target_type: "task",
        target_id: "wi-lock-cli",
        holder: "cli-lock-test",
        created_at: "2026-06-20T00:00:00.000Z",
        expires_at: "2099-06-23T05:14:36.020Z",
        entropy: "entropy-lock-cli",
      });
      if (claim.outcome !== "acquired") {
        throw new Error("Expected the claim to be acquired.");
      }

      const create = JSON.parse(
        runCli(root, [
          "lock",
          "create",
          "--claim",
          claim.claimToken,
          "backlog/clean.md",
          "backlog/dirty.md",
          "--json",
        ]),
      ) as { outcome: string; locks: Array<{ path: string }> };
      expect(create).toMatchObject({
        outcome: "acquired",
        locks: [
          {
            path: "backlog/clean.md",
          },
          {
            path: "backlog/dirty.md",
          },
        ],
      });

      await fs.appendFile(path.join(root, "backlog", "dirty.md"), "changed\n");

      const status = JSON.parse(
        runCli(root, ["lock", "status", "--claim", claim.claimToken, "--json"]),
      ) as {
        claimToken: string;
        state: string;
        locks: Array<{ path: string; key: string; state: string }>;
      };
      expect(status).toMatchObject({
        claimToken: claim.claimToken,
        state: "active",
        locks: [
          {
            path: "backlog/clean.md",
            state: "clean",
          },
          {
            path: "backlog/dirty.md",
            state: "modified",
          },
        ],
      });

      let removalConflictOutput: string;
      try {
        removalConflictOutput = runCli(root, [
          "lock",
          "rm",
          "--claim",
          claim.claimToken,
          "backlog/clean.md",
          "backlog/dirty.md",
          "--json",
        ]);
      } catch (error) {
        removalConflictOutput = String((error as { stdout?: unknown }).stdout ?? "");
      }
      const removalConflict = JSON.parse(removalConflictOutput) as {
        outcome: string;
        conflicts: Array<{ path: string; reason: string; state?: string }>;
      };
      expect(removalConflict).toMatchObject({
        outcome: "conflict",
        conflicts: [
          expect.objectContaining({
            path: "backlog/dirty.md",
            reason: "modified",
            state: "modified",
          }),
        ],
      });
      expect(store.listLocksByClaimToken(claim.claimToken)).toHaveLength(2);

      const removal = JSON.parse(
        runCli(root, [
          "lock",
          "rm",
          "--claim",
          claim.claimToken,
          "backlog/clean.md",
          "--json",
        ]),
      ) as { outcome: string; removed: Array<{ path: string }> };
      expect(removal).toMatchObject({
        outcome: "removed",
        removed: [
          {
            path: "backlog/clean.md",
          },
        ],
      });
      expect(store.listLocksByClaimToken(claim.claimToken)).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});
