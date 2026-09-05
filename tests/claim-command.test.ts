import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { execFile, execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  openRuntimeSqliteStore,
  RUNTIME_SCHEMA_VERSION,
} from "../lib/runtime/sqlite-store.js";

const tempDirs: string[] = [];
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const execFileAsync = promisify(execFile);
const cliPath = path.resolve(__dirname, "../cli/doc-vader.ts");

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) =>
      fs.rm(dir, { recursive: true, force: true }),
    ),
  );
});

async function mkRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-claim-"));
  tempDirs.push(root);
  return root;
}

function runCli(root: string, args: string[], input?: string): string {
  return execFileSync("node", ["--import", tsxImport, cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    input,
  });
}

async function runCliAsync(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "node",
    ["--import", tsxImport, cliPath, ...args],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  return stdout;
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function writeTask(
  root: string,
  fileName: string,
  frontmatter = `id: wi-${path.basename(fileName, ".md")}
title: ${path.basename(fileName, ".md")}
summary: ${path.basename(fileName, ".md")}
type: work-item
subtype: story
lifecycle: active
status: ready
status_reason: auto
tags:
  - afk`,
  body = "## Acceptance Criteria\n\n- [ ] Do the thing\n",
): Promise<void> {
  await fs.mkdir(path.join(root, "backlog"), { recursive: true });
  await fs.writeFile(
    path.join(root, "backlog", fileName),
    `---\n${frontmatter}\n---\n\n${body}`,
    "utf8",
  );
}

function acquireRuntimeTaskClaim(
  root: string,
  taskId: string,
  lockPaths: string[] = [],
): string {
  const store = openRuntimeSqliteStore({ rootDir: root });
  try {
    const result = store.acquireRuntimeClaim(
      {
        schema_version: RUNTIME_SCHEMA_VERSION,
        target_type: "task",
        target_id: taskId,
        holder: "cli-claim-test",
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      },
      { initialLockPaths: lockPaths },
    );
    if (result.outcome !== "acquired") {
      throw new Error(`Failed to acquire runtime claim for ${taskId}.`);
    }
    return result.claimToken;
  } finally {
    store.close();
  }
}

describe.sequential("claim command surface", () => {
  it("creates, reports, completes, and fails runtime claims with claim-scoped completion", { timeout: 30_000 }, async () => {
    const root = await mkRoot();
    try {
      await writeTask(
        root,
        "60373-create.md",
        `id: wi-60373-create
title: 60373-create
summary: 60373-create
type: work-item
subtype: story
lifecycle: active
status: ready
status_reason: auto
actual: 1
tags:
  - afk`,
        "## Tasks\n\n- [x] Do the thing\n\n## Acceptance Criteria\n\n- [x] Do the thing\n",
      );

      const created = acquireRuntimeTaskClaim(root, "wi-60373-create", [
        "backlog/60373-create.md",
        "backlog/records/record-wi-60373-create-evidence.md",
      ]);

      const status = JSON.parse(
        runCli(root, ["claim", "status", created, "--json"]),
      ) as {
        claimToken: string;
        state: string;
        claim: { claim_token: string; target_id: string; state: string } | null;
      };
      expect(status).toMatchObject({
        claimToken: created,
        state: "active",
        claim: {
          claim_token: created,
          target_id: "wi-60373-create",
          state: "active",
        },
      });

      const bulkStatus = runCli(root, ["claim"]);
      expect(bulkStatus).toContain(created);
      expect(bulkStatus).toContain("active");

      const lockResult = JSON.parse(
        runCli(root, [
          "lock",
          "create",
          "--claim",
          created,
          "backlog/60373-create.md",
          "backlog/records/record-wi-60373-create-evidence.md",
          "--json",
        ]),
      ) as { outcome: string };
      expect(lockResult.outcome).toBe("acquired");

      const evidence = JSON.parse(
        runCli(
          root,
          [
          "work",
          "wi-60373-create",
          "record",
          "--claim",
          created,
          "--type",
          "test-result",
          "--payload",
            "-",
            "--json",
          ],
          JSON.stringify({
            id: "record:wi-60373-create-evidence",
            summary: "Completion validation",
            observation: "Claim-scoped completion recorded evidence.",
            outcome: "pass",
          }),
        ),
      ) as { taskId: string; evidenceLink: string };
      expect(evidence).toMatchObject({
        taskId: "wi-60373-create",
        evidenceLink: "[[record-wi-60373-create-evidence]]",
      });

      const completed = JSON.parse(
        runCli(root, [
          "claim",
          "release",
          created,
          "--outcome",
          "success",
          "--json",
        ]),
      ) as {
        claimId: string;
        taskId: string;
        execution?: { executionLogEntry: { state: string; reason: string } };
      };
      expect(completed).toMatchObject({
        claimId: created,
        taskId: "wi-60373-create",
      });

      const postCompleteStore = openRuntimeSqliteStore({ rootDir: root });
      try {
        expect(postCompleteStore.listClaims()).toHaveLength(0);
        expect(postCompleteStore.listLocks()).toHaveLength(0);
        expect(postCompleteStore.listExecutionLogEntries()).toHaveLength(2);
        expect(
          postCompleteStore.listExecutionLogEntries()[1],
        ).toMatchObject({
          claim_token: created,
          state: "completed",
          reason: "success",
        });
      } finally {
        postCompleteStore.close();
      }

      const completedTask = await fs.readFile(
        path.join(root, "backlog/60373-create.md"),
        "utf8",
      );
      expect(completedTask).toContain("status: completed");
      expect(completedTask).toContain("[[record-wi-60373-create-evidence]]");

      const reacquired = acquireRuntimeTaskClaim(root, "wi-60373-create");

      await writeTask(
        root,
        "60373-fail.md",
        `id: wi-60373-fail
title: 60373-fail
summary: 60373-fail
type: work-item
subtype: story
lifecycle: active
status: ready
status_reason: auto
tags:
  - afk`,
        "## Acceptance Criteria\n\n- [x] Do the thing\n",
      );

      const failCreated = acquireRuntimeTaskClaim(root, "wi-60373-fail");

      const failed = JSON.parse(
        runCli(root, [
          "claim",
          "release",
          failCreated,
          "--outcome",
          "failed",
          "--json",
        ]),
      ) as {
        claimToken: string;
        locksRemoved: number;
        executionLogEntry: { state: string; reason: string };
      };
      expect(failed).toMatchObject({
        claimToken: failCreated,
        locksRemoved: 0,
        executionLogEntry: {
          state: "failed",
          reason: "error",
        },
      });

      const postFailStore = openRuntimeSqliteStore({ rootDir: root });
      try {
        expect(postFailStore.listClaims()).toHaveLength(1);
        expect(postFailStore.listClaims()[0]).toMatchObject({
          claim_token: reacquired,
          target_id: "wi-60373-create",
          state: "active",
        });
        expect(postFailStore.listLocks()).toHaveLength(0);
        expect(postFailStore.listExecutionLogEntries()).toHaveLength(5);
        expect(postFailStore.listExecutionLogEntries()[4]).toMatchObject({
          claim_token: failCreated,
          state: "failed",
          reason: "error",
        });
      } finally {
        postFailStore.close();
      }

      const postFailCompletedTask = await fs.readFile(
        path.join(root, "backlog/60373-create.md"),
        "utf8",
      );
      const failedTask = await fs.readFile(
        path.join(root, "backlog/60373-fail.md"),
        "utf8",
      );
      expect(postFailCompletedTask).toContain("status: completed");
      expect(failedTask).toContain("status: ready");
      expect(failedTask).not.toContain("status: completed");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("supports dry-run completion without mutating runtime state", { timeout: 30_000 }, async () => {
    const root = await mkRoot();
    try {
      await writeTask(
        root,
        "60373-dry-run.md",
        `id: wi-60373-dry-run
title: 60373-dry-run
summary: 60373-dry-run
type: work-item
subtype: story
lifecycle: active
status: ready
status_reason: auto
actual: 1
tags:
  - afk`,
        "## Tasks\n\n- [x] Do the thing\n\n## Acceptance Criteria\n\n- [x] Do the thing\n",
      );

      const created = acquireRuntimeTaskClaim(root, "wi-60373-dry-run", [
        "backlog/60373-dry-run.md",
        "backlog/records/record-wi-60373-dry-run-evidence.md",
      ]);

      JSON.parse(
        runCli(root, [
          "lock",
          "create",
          "--claim",
          created,
          "backlog/60373-dry-run.md",
          "backlog/records/record-wi-60373-dry-run-evidence.md",
          "--json",
        ]),
      );

      JSON.parse(
        runCli(
          root,
          [
          "work",
          "wi-60373-dry-run",
          "record",
          "--claim",
          created,
          "--type",
          "test-result",
          "--payload",
            "-",
            "--json",
          ],
          JSON.stringify({
            id: "record:wi-60373-dry-run-evidence",
            summary: "Dry run validation",
            observation: "Evidence exists before dry-run completion.",
            outcome: "pass",
          }),
        ),
      );

      const preview = JSON.parse(
        runCli(root, [
          "claim",
          "release",
          created,
          "--outcome",
          "success",
          "--dry-run",
          "--json",
        ]),
      ) as { dryRun: boolean; taskId: string };
      expect(preview).toMatchObject({
        dryRun: true,
        taskId: "wi-60373-dry-run",
      });

      const store = openRuntimeSqliteStore({ rootDir: root });
      try {
        expect(store.listClaims()).toHaveLength(1);
        expect(store.listLocks()).toHaveLength(2);
      } finally {
        store.close();
      }

      const workItem = await fs.readFile(
        path.join(root, "backlog/60373-dry-run.md"),
        "utf8",
      );
      expect(workItem).toContain("status: ready");
      expect(workItem).not.toContain("status: completed");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("releases a blocked claim with an uppercase task diagnostic code", async () => {
    const root = await mkRoot();
    try {
      await writeTask(root, "60373-blocked-release.md");
      const claimToken = acquireRuntimeTaskClaim(root, "wi-60373-blocked-release");

      const released = JSON.parse(
        runCli(root, [
          "claim",
          "release",
          claimToken,
          "--outcome",
          "blocked",
          "--code",
          "TASK_RECORD_CHANGED_FILE_LOCK_AUDIT_FAILED",
          "--message",
          "Record coverage audit was blocked.",
          "--json",
        ]),
      ) as {
        claimToken: string;
        executionLogEntry: { state: string; reason: string; detail: Record<string, unknown> };
      };

      expect(released).toMatchObject({
        claimToken,
        executionLogEntry: {
          state: "halted",
          reason: "blocked",
        },
      });

      const store = openRuntimeSqliteStore({ rootDir: root });
      try {
        expect(store.getClaimByToken(claimToken)).toBeUndefined();
        const execution = store.listExecutionLogEntries(claimToken).at(-1);
        expect(execution).toBeDefined();
        expect(JSON.parse(execution!.payload)).toMatchObject({
          detail: {
            code: "task-record-changed-file-lock-audit-failed",
            "x-source-code": "TASK_RECORD_CHANGED_FILE_LOCK_AUDIT_FAILED",
          },
        });
      } finally {
        store.close();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("records claim evidence from its worktree without auditing root-only control artifacts", async () => {
    const root = await mkRoot();
    const worktree = `${root}-wi-60373-worktree-record`;
    tempDirs.push(worktree);
    try {
      await writeTask(root, "60373-worktree-record.md");
      git(root, ["init", "--initial-branch", "main"]);
      git(root, ["config", "user.email", "agent@example.com"]);
      git(root, ["config", "user.name", "Agent"]);
      git(root, ["add", "backlog/60373-worktree-record.md"]);
      git(root, ["commit", "-m", "fixture"]);
      git(root, ["worktree", "add", "-b", "afk/wi-60373-worktree-record", worktree]);

      const claimToken = acquireRuntimeTaskClaim(root, "wi-60373-worktree-record", [
        "backlog/60373-worktree-record.md",
        "backlog/records/record-wi-60373-worktree-record.md",
      ]);
      await fs.mkdir(path.join(root, ".sandcastle"), { recursive: true });
      await fs.writeFile(
        path.join(root, ".sandcastle", "root-only-control.json"),
        "{}\n",
        "utf8",
      );

      const recorded = JSON.parse(
        runCli(
          worktree,
          [
            "work",
            "wi-60373-worktree-record",
            "record",
            "--claim",
            claimToken,
            "--type",
            "test-result",
            "--payload",
            "-",
            "--json",
          ],
          JSON.stringify({
            id: "record:wi-60373-worktree-record",
            summary: "Worktree-scoped evidence",
            observation: "Audit must read the active item worktree.",
            outcome: "pass",
          }),
        ),
      ) as { taskId: string; record: { filePath: string } };

      expect(recorded).toMatchObject({ taskId: "wi-60373-worktree-record" });
      await expect(fs.access(recorded.record.filePath)).resolves.toBeUndefined();
    } finally {
      try {
        git(root, ["worktree", "remove", "--force", worktree]);
      } catch {
        // Fixture setup may fail before the linked worktree is registered.
      }
      await fs.rm(worktree, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails claim completion before durable writes when evidence is missing", async () => {
    const root = await mkRoot();
    try {
      await writeTask(
        root,
        "60373-complete-fail.md",
        `id: wi-60373-complete-fail
title: 60373-complete-fail
summary: 60373-complete-fail
type: work-item
subtype: story
lifecycle: active
status: ready
status_reason: auto
tags:
  - afk`,
        "## Acceptance Criteria\n\n- [x] Do the thing\n",
      );

      const created = acquireRuntimeTaskClaim(root, "wi-60373-complete-fail");

      expect(() =>
        runCli(root, [
          "claim",
          "release",
          created,
          "--outcome",
          "success",
          "--json",
        ]),
      ).toThrow(/TASK_TRANSITION_MISSING_EVIDENCE/);

      const store = openRuntimeSqliteStore({ rootDir: root });
      try {
        expect(store.listClaims()).toHaveLength(1);
        expect(store.listExecutionLogEntries()).toHaveLength(1);
      } finally {
        store.close();
      }

      const workItem = await fs.readFile(
        path.join(root, "backlog/60373-complete-fail.md"),
        "utf8",
      );
      expect(workItem).toContain("status: ready");
      expect(workItem).not.toContain("status: completed");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("creates a runtime claim through the canonical work-item route", async () => {
    const root = await mkRoot();
    try {
      await writeTask(root, "60373-alias.md");
      const authority = openRuntimeSqliteStore({ rootDir: root });
      authority.close();

      const created = JSON.parse(
        runCli(root, [
          "work",
          "wi-60373-alias",
          "claim",
          "--holder",
          "cli-claim-test",
          "--json",
        ]),
      ) as {
        outcome: string;
        claimToken: string;
        executionLogEntry: { state: string; reason: string };
      };
      expect(created).toMatchObject({
        outcome: "acquired",
        executionLogEntry: {
          state: "running",
          reason: "started",
        },
      });

      const store = openRuntimeSqliteStore({ rootDir: root });
      try {
        expect(store.listClaims()).toHaveLength(1);
        expect(store.listClaims()[0]).toMatchObject({
          claim_token: created.claimToken,
          target_id: "wi-60373-alias",
          holder: "cli-claim-test",
        });
      } finally {
        store.close();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("releases and cleans up root claims through the shared authority from a registered worktree", async () => {
    const root = await mkRoot();
    const worktree = `${root}-lifecycle-worktree`;
    tempDirs.push(worktree);
    try {
      await writeTask(root, "60460-lifecycle.md");
      await writeTask(root, "60460-lifecycle-cleanup.md");
      git(root, ["init", "--initial-branch", "main"]);
      git(root, ["config", "user.email", "agent@example.com"]);
      git(root, ["config", "user.name", "Agent"]);
      git(root, ["add", "."]);
      git(root, ["commit", "-m", "fixture"]);
      git(root, ["worktree", "add", "-b", "claim-lifecycle", worktree]);

      const released = JSON.parse(
        runCli(root, [
          "claim",
          "create",
          "--target",
          "task:wi-60460-lifecycle",
          "--holder",
          "root-agent",
          "--json",
        ]),
      ) as { claimToken: string };
      runCli(worktree, [
        "claim",
        "release",
        released.claimToken,
        "--outcome",
        "failed",
        "--json",
      ]);

      const releasedAtRoot = JSON.parse(
        runCli(root, ["claim", "status", released.claimToken, "--json"]),
      ) as { state: string };
      const releasedInWork = JSON.parse(
        runCli(worktree, ["work", "wi-60460-lifecycle", "status", "--json"]),
      ) as {
        runtime?: {
          latestExecutionLog?: { claimToken?: string; claimState?: string; state?: string };
        };
      };
      expect(releasedAtRoot.state).toBe("missing");
      expect(releasedInWork.runtime?.latestExecutionLog).toMatchObject({
        claimToken: released.claimToken,
        claimState: "missing",
        state: "failed",
      });

      const expired = JSON.parse(
        runCli(root, [
          "claim",
          "create",
          "--target",
          "task:wi-60460-lifecycle-cleanup",
          "--holder",
          "root-agent",
          "--ttl-minutes",
          "-1",
          "--json",
        ]),
      ) as { claimToken: string };
      const terminalStore = openRuntimeSqliteStore({ rootDir: root });
      try {
        terminalStore.insertExecutionLogEntry({
          schema_version: RUNTIME_SCHEMA_VERSION,
          claim_token: expired.claimToken,
          target_type: "task",
          target_id: "wi-60460-lifecycle-cleanup",
          state: "failed",
          reason: "error",
          created_at: new Date().toISOString(),
          detail: { code: "x-runtime-claim-failed" },
        });
      } finally {
        terminalStore.close();
      }
      runCli(root, ["claim", "status", expired.claimToken, "--json"]);
      const cleanup = JSON.parse(
        runCli(worktree, ["claim", "cleanup", "--expired", "until=now", "--json"]),
      ) as { outcome: string; removed: Array<{ claimToken: string }> };
      const cleanedAtRoot = JSON.parse(
        runCli(root, ["claim", "status", expired.claimToken, "--json"]),
      ) as { state: string };
      const cleanedInWork = JSON.parse(
        runCli(worktree, ["work", "wi-60460-lifecycle-cleanup", "status", "--json"]),
      ) as {
        runtime?: { latestExecutionLog?: { claimToken?: string; claimState?: string } };
      };
      expect(cleanup).toMatchObject({
        outcome: "removed",
        removed: [{ claimToken: expired.claimToken }],
      });
      expect(cleanedAtRoot.state).toBe("missing");
      expect(cleanedInWork.runtime?.latestExecutionLog).toMatchObject({
        claimToken: expired.claimToken,
        claimState: "missing",
      });
      await expect(
        fs.access(path.join(worktree, ".doc-vader", "runtime", "runtime.sqlite")),
      ).rejects.toThrow();
    } finally {
      try {
        git(root, ["worktree", "remove", "--force", worktree]);
      } catch {
        // The worktree may not have been created if fixture setup failed.
      }
      await fs.rm(worktree, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 90_000);

  it("does not fail on missing lifecycle authority and initializes claim authority as needed", async () => {
    const root = await mkRoot();
    const worktree = `${root}-missing-lifecycle-authority`;
    tempDirs.push(worktree);
    try {
      await writeTask(root, "60460-missing-lifecycle.md");
      git(root, ["init", "--initial-branch", "main"]);
      git(root, ["config", "user.email", "agent@example.com"]);
      git(root, ["config", "user.name", "Agent"]);
      git(root, ["add", "."]);
      git(root, ["commit", "-m", "fixture"]);
      git(root, ["worktree", "add", "-b", "claim-missing-lifecycle", worktree]);

      let releaseOutput = "";
      try {
        runCli(worktree, [
          "claim",
          "release",
          "claim-missing",
          "--outcome",
          "failed",
          "--json",
        ]);
      } catch (error) {
        const captured = error as { stdout?: unknown; stderr?: unknown };
        releaseOutput = `${String(captured.stdout ?? "")}\n${String(captured.stderr ?? "")}`;
      }
      expect(releaseOutput).toContain("Unknown runtime claim token: claim-missing");

      const cleanupOutput = runCli(worktree, [
        "claim",
        "cleanup",
        "claim-missing",
        "--json",
      ]);
      const cleanup = JSON.parse(cleanupOutput) as {
        outcome: string;
        removed: Array<{ claimToken: string }>;
      };
      expect(cleanup).toMatchObject({
        outcome: "removed",
        removed: [],
      });

      expect(JSON.parse(runCli(root, ["claim", "status", "claim-missing", "--json"])).state)
        .toBe("missing");
      expect(JSON.parse(runCli(worktree, ["claim", "status", "claim-missing", "--json"])).state)
        .toBe("missing");
    } finally {
      try {
        git(root, ["worktree", "remove", "--force", worktree]);
      } catch {
        // The worktree may not have been created if fixture setup failed.
      }
      await fs.rm(worktree, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 90_000);

  it("renews a runtime claim through the public claim command", async () => {
    const root = await mkRoot();
    try {
      await writeTask(root, "claim-renew.md");
      const created = JSON.parse(
        runCli(root, [
          "claim",
          "create",
          "--target",
          "task:wi-claim-renew",
          "--holder",
          "cli-claim-test",
          "--json",
        ]),
      ) as { claimToken: string };
      const before = openRuntimeSqliteStore({ rootDir: root });
      let expiresAt: string;
      try {
        const claim = before.getClaimByToken(created.claimToken);
        if (!claim) {
          throw new Error("Expected runtime claim to exist.");
        }
        expiresAt = claim.expires_at;
      } finally {
        before.close();
      }

      const renewed = JSON.parse(
        runCli(root, ["claim", "renew", created.claimToken, "--json"]),
      ) as {
        outcome: string;
        claimToken: string;
        claim: { claim_token: string; expires_at: string; last_seen_at?: string };
      };
      expect(renewed).toMatchObject({
        outcome: "renewed",
        claimToken: created.claimToken,
        claim: { claim_token: created.claimToken },
      });
      expect(Date.parse(renewed.claim.expires_at)).toBeGreaterThan(
        Date.parse(expiresAt),
      );
      expect(renewed.claim.last_seen_at).toBeTruthy();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("refreshes claim context visibility without extending expiry on status reads", async () => {
    const root = await mkRoot();
    try {
      await writeTask(root, "60373-status.md");

      const created = JSON.parse(
        runCli(root, [
          "claim",
          "create",
          "--target",
          "task:wi-60373-status",
          "--holder",
          "cli-claim-test",
          "--json",
        ]),
      ) as { outcome: string; claimToken: string };
      expect(created.outcome).toBe("acquired");

      const store = openRuntimeSqliteStore({ rootDir: root });
      try {
        store.database
          .prepare(
            "UPDATE claims SET last_seen_at = ?, expires_at = ? WHERE claim_token = ?",
          )
          .run(
            "2026-06-20T00:00:00.000Z",
            "2026-06-21T00:00:00.000Z",
            created.claimToken,
          );
      } finally {
        store.close();
      }

      const status = JSON.parse(
        runCli(root, ["claim", "status", created.claimToken, "--json"]),
      ) as {
        claim: { last_seen_at?: string; expires_at: string };
      };
      expect(status.claim.last_seen_at).toBeTruthy();

      const postStatusStore = openRuntimeSqliteStore({ rootDir: root });
      try {
        const claim = postStatusStore.getClaimByToken(created.claimToken);
        expect(claim).toMatchObject({
          claim_token: created.claimToken,
          expires_at: "2026-06-21T00:00:00.000Z",
        });
        expect(claim?.last_seen_at).not.toBe("2026-06-20T00:00:00.000Z");
      } finally {
        postStatusStore.close();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it(
    "rejects runtime claim creation for tasks whose latest execution log is not ready-permitting",
    { timeout: 15_000 },
    async () => {
      const root = await mkRoot();
      const store = openRuntimeSqliteStore({ rootDir: root });
      try {
        await writeTask(root, "60343-blocked.md");
        store.insertExecutionLogEntry({
          schema_version: "runtime-entity/v1",
          claim_token: "claim-wi-60343-blocked",
          target_type: "task",
          target_id: "wi-60343-blocked",
          state: "halted",
          reason: "blocked",
          created_at: "2026-06-15T12:00:00.000Z",
          detail: {
            code: "x-runtime-task-blocked",
            message: "Blocked by runtime execution.",
          },
        });
      } finally {
        store.close();
      }

      let output = "";
      try {
        runCli(root, [
          "claim",
          "create",
          "--target",
          "task:wi-60343-blocked",
          "--holder",
          "cli-claim-test",
          "--json",
        ]);
      } catch (error) {
        const captured = error as { stdout?: unknown; stderr?: unknown };
        output = [String(captured.stdout ?? ""), String(captured.stderr ?? "")].join(
          "\n",
        );
      }

      expect(output).toContain("TASK_NOT_CLAIMABLE");
      expect(output).toContain("execution-not-ready");
    },
  );

  it("allows two local agents to claim different eligible tasks in parallel", async () => {
    const root = await mkRoot();
    try {
      await writeTask(root, "60370-agent-a.md");
      await writeTask(root, "60370-agent-b.md");

      const [firstClaimOutput, secondClaimOutput] = await Promise.all([
        runCliAsync(root, [
          "claim",
          "create",
          "--target",
          "task:wi-60370-agent-a",
          "--holder",
          "sandcastle:agent-a",
          "--json",
        ]),
        runCliAsync(root, [
          "claim",
          "create",
          "--target",
          "task:wi-60370-agent-b",
          "--holder",
          "sandcastle:agent-b",
          "--json",
        ]),
      ]);
      const firstClaim = JSON.parse(firstClaimOutput) as {
        outcome: string;
        claimToken: string;
      };
      const secondClaim = JSON.parse(secondClaimOutput) as {
        outcome: string;
        claimToken: string;
      };

      expect(firstClaim.outcome).toBe("acquired");
      expect(secondClaim.outcome).toBe("acquired");
      expect(firstClaim.claimToken).not.toBe(secondClaim.claimToken);

      const store = openRuntimeSqliteStore({ rootDir: root });
      try {
        const claims = store.listClaims();
        expect(claims).toHaveLength(2);
        expect(claims.map((claim) => claim.target_id).sort()).toEqual([
          "wi-60370-agent-a",
          "wi-60370-agent-b",
        ]);
      } finally {
        store.close();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("filters bulk claim status by time selector and rejects bare mutating claims with help", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      store.insertClaim({
        schema_version: "runtime-entity/v1",
        claim_token: "claim-expired-status",
        target_type: "task",
        target_id: "wi-expired-status",
        holder: "cli-claim-test",
        created_at: "2026-06-20T00:00:00.000Z",
        expires_at: "2026-06-20T00:30:00.000Z",
      });
      store.insertClaim({
        schema_version: "runtime-entity/v1",
        claim_token: "claim-active-status",
        target_type: "task",
        target_id: "wi-active-status",
        holder: "cli-claim-test",
        created_at: "2099-06-21T00:00:00.000Z",
        expires_at: "2099-06-23T00:00:00.000Z",
      });
    } finally {
      store.close();
    }

    const filtered = JSON.parse(
      runCli(root, ["claim", "status", "--filter", "until=now", "--json"]),
    ) as {
      claims: Array<{ claim_token: string; state: string }>;
    };
    expect(filtered.claims.map((claim) => claim.claim_token)).toEqual([
      "claim-expired-status",
    ]);
    expect(filtered.claims[0]).toMatchObject({
      state: "expired",
    });

    let createOutput = "";
    try {
      createOutput = runCli(root, ["claim", "create", "--json"]);
    } catch (error) {
      const captured = error as { stdout?: unknown; stderr?: unknown };
      createOutput = [
        String(captured.stdout ?? ""),
        String(captured.stderr ?? ""),
      ].join("\n");
    }
    expect(createOutput).toContain("Usage:");
    expect(createOutput).toContain("claim create");
    expect(createOutput).toContain("--target <target>");
  });

  it("shares Claim authority facts across the root and registered worktrees", async () => {
    const root = await mkRoot();
    const firstWorktree = `${root}-first`;
    const secondWorktree = `${root}-second`;
    tempDirs.push(firstWorktree, secondWorktree);
    try {
      await writeTask(root, "60460-shared.md");
      git(root, ["init", "--initial-branch", "main"]);
      git(root, ["config", "user.email", "agent@example.com"]);
      git(root, ["config", "user.name", "Agent"]);
      git(root, ["add", "."]);
      git(root, ["commit", "-m", "fixture"]);
      git(root, ["worktree", "add", "-b", "claim-authority-first", firstWorktree]);
      git(root, ["worktree", "add", "-b", "claim-authority-second", secondWorktree]);

      const created = JSON.parse(
        runCli(root, [
          "claim",
          "create",
          "--target",
          "task:wi-60460-shared",
          "--holder",
          "claim-authority-test",
          "--json",
        ]),
      ) as { claimToken: string };

      const claimStatuses = [root, firstWorktree, secondWorktree].map(
        (worktree) =>
          JSON.parse(
            runCli(worktree, ["claim", "status", created.claimToken, "--json"]),
          ) as { claim: { claim_token: string } },
      );
      for (const claimStatus of claimStatuses) {
        expect(claimStatus.claim.claim_token).toBe(created.claimToken);
      }

      const reports = [root, firstWorktree, secondWorktree].map(
        (worktree) =>
          JSON.parse(
            runCli(worktree, ["work", "wi-60460-shared", "status", "--json"]),
          ) as {
            runtime?: {
              latestExecutionLog?: {
                claimToken: string;
                claimState: string;
                lockCount: number;
              };
            };
          },
      );
      for (const report of reports) {
        expect(report.runtime?.latestExecutionLog).toMatchObject({
          claimToken: created.claimToken,
          claimState: "active",
        });
        expect(report.runtime?.latestExecutionLog?.lockCount).toBeGreaterThan(0);
      }

      const update = JSON.parse(
        runCli(secondWorktree, [
          "work",
          "wi-60460-shared",
          "update",
          "--input",
          '{"status":"ready","assignee":"worktree-agent"}',
          "--claim",
          created.claimToken,
          "--json",
        ]),
      ) as { frontmatter: { assignee: string } };
      expect(update.frontmatter.assignee).toBe("worktree-agent");
      await expect(
        fs.readFile(path.join(secondWorktree, "backlog", "60460-shared.md"), "utf8"),
      ).resolves.toContain("assignee: worktree-agent");

      await expect(
        fs.access(path.join(firstWorktree, ".doc-vader", "runtime", "runtime.sqlite")),
      ).rejects.toThrow();
      await expect(
        fs.access(path.join(secondWorktree, ".doc-vader", "runtime", "runtime.sqlite")),
      ).rejects.toThrow();
    } finally {
      await fs.rm(firstWorktree, { recursive: true, force: true });
      await fs.rm(secondWorktree, { recursive: true, force: true });
    }
  });

  it("terminally closes root and registered-worktree artifacts through one Claim lock identity", async () => {
    const root = await mkRoot();
    const worktree = `${root}-terminal-worktree`;
    tempDirs.push(worktree);
    const completedFrontmatter = (id: string, title: string) => `id: ${id}
title: ${title}
summary: ${title}
type: work-item
subtype: story
lifecycle: active
status: ready
status_reason: auto
actual: 1
links:
  evidence:
    - "[[record-${id}-evidence]]"
tags:
  - afk`;
    const completedBody = "## Tasks\n\n- [x] Do the thing\n\n## Acceptance Criteria\n\n- [x] Do the thing\n";
    try {
      await writeTask(
        root,
        "60460-root-terminal.md",
        completedFrontmatter("wi-60460-root-terminal", "Root terminal"),
        completedBody,
      );
      await writeTask(
        root,
        "60460-worktree-terminal.md",
        completedFrontmatter("wi-60460-worktree-terminal", "Worktree terminal"),
        completedBody,
      );
      git(root, ["init", "--initial-branch", "main"]);
      git(root, ["config", "user.email", "agent@example.com"]);
      git(root, ["config", "user.name", "Agent"]);
      git(root, ["add", "."]);
      git(root, ["commit", "-m", "fixture"]);
      git(root, ["worktree", "add", "-b", "claim-terminal", worktree]);

      const rootClaim = JSON.parse(
        runCli(root, [
          "claim",
          "create",
          "--target",
          "task:wi-60460-root-terminal",
          "--holder",
          "root-agent",
          "--json",
        ]),
      ) as { claimToken: string };
      runCli(root, [
        "work",
        "wi-60460-root-terminal",
        "update",
        "--input",
        '{"status":"completed","actual":1}',
        "--claim",
        rootClaim.claimToken,
        "--json",
      ]);
      expect(
        JSON.parse(runCli(root, ["claim", "status", rootClaim.claimToken, "--json"])),
      ).toMatchObject({ state: "missing" });

      const worktreeConsumerConfig = path.join(root, "worktree-consumer.json");
      await fs.writeFile(
        worktreeConsumerConfig,
        JSON.stringify({
          roots: {
            backlog: path.join(worktree, "backlog"),
            active: path.join(worktree, "backlog"),
            archive: path.join(worktree, "backlog", "archive"),
            records: path.join(worktree, "backlog", "records"),
            audit: path.join(worktree, "backlog", "audit"),
          },
        }),
        "utf8",
      );
      const worktreeClaim = JSON.parse(
        runCli(root, [
          "claim",
          "create",
          "--target",
          "task:wi-60460-worktree-terminal",
          "--holder",
          "worktree-agent",
          "--json",
        ]),
      ) as { claimToken: string };
      const worktreeCloseout = JSON.parse(
        runCli(root, [
          "work",
          "wi-60460-worktree-terminal",
          "update",
          "--input",
          '{"status":"completed","actual":1}',
          "--claim",
          worktreeClaim.claimToken,
          "--consumer-config",
          worktreeConsumerConfig,
          "--json",
        ]),
      ) as { filePath: string; frontmatter: { status: string } };
      expect(worktreeCloseout).toMatchObject({
        filePath: path.join(worktree, "backlog", "60460-worktree-terminal.md"),
        frontmatter: { status: "completed" },
      });
      expect(
        JSON.parse(runCli(root, ["claim", "status", worktreeClaim.claimToken, "--json"])),
      ).toMatchObject({ state: "missing" });

      const store = openRuntimeSqliteStore({ rootDir: root });
      try {
        expect(store.listClaims()).toHaveLength(0);
        expect(store.listLocks()).toHaveLength(0);
      } finally {
        store.close();
      }
    } finally {
      try {
        git(root, ["worktree", "remove", "--force", worktree]);
      } catch {
        // The worktree may not have been created if fixture setup failed.
      }
      await fs.rm(worktree, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 90_000);

  it("initializes shared authority across Claim-dependent Work commands when it is missing", async () => {
    const root = await mkRoot();
    const worktree = `${root}-missing-authority`;
    tempDirs.push(worktree);
    try {
      await writeTask(
        root,
        "60460-missing-authority.md",
        `id: wi-60460-missing-authority
title: Missing Claim Authority
summary: Missing shared Claim authority
type: work-item
subtype: story
lifecycle: active
status: ready
status_reason: auto
tags:
  - afk`,
        "## Acceptance Criteria\n\n- [x] Do the thing\n",
      );
      git(root, ["init", "--initial-branch", "main"]);
      git(root, ["config", "user.email", "agent@example.com"]);
      git(root, ["config", "user.name", "Agent"]);
      git(root, ["add", "."]);
      git(root, ["commit", "-m", "fixture"]);
      git(root, ["worktree", "add", "-b", "claim-authority-missing", worktree]);

      const workItemId = "wi-60460-missing-authority";
      const rootStatus = JSON.parse(
        runCli(root, ["work", workItemId, "status", "--json"]),
      ) as { id: string };
      expect(rootStatus.id).toBe(workItemId);

      const created = JSON.parse(
        runCli(root, ["work", workItemId, "claim", "--json"]),
      ) as { outcome: string; claimToken: string };
      expect(created.outcome).toBe("acquired");

      const worktreeStatus = JSON.parse(
        runCli(worktree, ["work", workItemId, "status", "--json"]),
      ) as { id: string; runtime?: { latestExecutionLog?: { claimToken?: string } } };
      expect(worktreeStatus).toMatchObject({
        id: workItemId,
        runtime: { latestExecutionLog: { claimToken: created.claimToken } },
      });

      let conflictOutput = "";
      try {
        runCli(worktree, ["work", workItemId, "claim", "--json"]);
      } catch (error) {
        const captured = error as { stdout?: unknown; stderr?: unknown };
        conflictOutput = `${String(captured.stdout ?? "")}\n${String(captured.stderr ?? "")}`;
      }
      expect(conflictOutput).toContain("TASK_NOT_CLAIMABLE");
      expect(conflictOutput).toContain("execution-not-ready");

      await expect(
        fs.access(path.join(root, ".doc-vader", "runtime", "runtime.sqlite")),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(worktree, ".doc-vader", "runtime", "runtime.sqlite")),
      ).rejects.toThrow();
    } finally {
      await fs.rm(worktree, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 90_000);

  it("initializes the shared authority instead of reading a worktree-local database", async () => {
    const root = await mkRoot();
    const worktree = `${root}-unavailable`;
    tempDirs.push(worktree);
    try {
      await writeTask(root, "60460-unavailable.md");
      git(root, ["init", "--initial-branch", "main"]);
      git(root, ["config", "user.email", "agent@example.com"]);
      git(root, ["config", "user.name", "Agent"]);
      git(root, ["add", "."]);
      git(root, ["commit", "-m", "fixture"]);
      git(root, ["worktree", "add", "-b", "claim-authority-unavailable", worktree]);
      const localDatabase = path.join(worktree, ".doc-vader", "runtime", "runtime.sqlite");
      await fs.mkdir(path.dirname(localDatabase), { recursive: true });
      await fs.writeFile(localDatabase, "legacy-local-authority", "utf8");

      const status = JSON.parse(
        runCli(root, ["work", "wi-60460-unavailable", "status", "--worktree", worktree, "--json"]),
      ) as { id: string };
      expect(status.id).toBe("wi-60460-unavailable");
      await expect(
        fs.access(path.join(root, ".doc-vader", "runtime", "runtime.sqlite")),
      ).resolves.toBeUndefined();
      await expect(fs.readFile(localDatabase, "utf8")).resolves.toBe("legacy-local-authority");
    } finally {
      await fs.rm(worktree, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("cleans up expired claims and refuses active claim cleanup", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const expired = store.insertClaim({
        schema_version: "runtime-entity/v1",
        claim_token: "claim-expired-cli",
        target_type: "task",
        target_id: "wi-expired-cli",
        holder: "cli-claim-test",
        created_at: "2026-06-20T00:00:00.000Z",
        expires_at: "2026-06-20T00:30:00.000Z",
      });
      store.insertLock({
        schema_version: "runtime-entity/v1",
        key: "e4c9a7f2f8e4d5f0d6b8d9d1e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3",
        path: "backlog/claim-prune.md",
        claim_token: expired.claim_token,
        target_type: "task",
        target_id: "wi-expired-cli",
        created_at: "2026-06-20T00:05:00.000Z",
      });
    } finally {
      store.close();
    }

    const pruned = JSON.parse(
      runCli(root, ["claim", "cleanup", "--expired", "until=now", "--json"]),
    ) as {
      outcome: string;
      removed: Array<{ claimToken: string; locksRemoved: number }>;
    };
    expect(pruned).toMatchObject({
      outcome: "removed",
      removed: [
        {
          claimToken: "claim-expired-cli",
          locksRemoved: 1,
        },
      ],
    });

    const postPruneStore = openRuntimeSqliteStore({ rootDir: root });
    try {
      expect(postPruneStore.listClaims()).toHaveLength(0);
      expect(postPruneStore.listLocks()).toHaveLength(0);
      expect(postPruneStore.listExecutionLogEntries()).toHaveLength(0);
    } finally {
      postPruneStore.close();
    }

    const activeStore = openRuntimeSqliteStore({ rootDir: root });
    let activeClaimToken = "";
    try {
      const active = activeStore.acquireRuntimeClaim({
        schema_version: "runtime-entity/v1",
        target_type: "task",
        target_id: "wi-active-cli",
        holder: "cli-claim-test",
        created_at: "2099-06-20T00:00:00.000Z",
        expires_at: "2099-06-23T00:00:00.000Z",
        entropy: "entropy-active-cli",
      });
      if (active.outcome !== "acquired") {
        throw new Error("Expected the claim to be acquired.");
      }
      activeClaimToken = active.claimToken;
    } finally {
      activeStore.close();
    }

    let rmOutput: string;
    try {
      rmOutput = runCli(root, ["claim", "cleanup", activeClaimToken!, "--json"]);
    } catch (error) {
      rmOutput = String((error as { stdout?: unknown }).stdout ?? "");
    }
    const removed = JSON.parse(rmOutput) as {
      outcome: string;
      conflicts: Array<{ claim_token: string; reason: string; state?: string }>;
    };
    expect(removed).toMatchObject({
      outcome: "conflict",
      conflicts: [
        {
          claim_token: activeClaimToken,
          reason: "active",
          state: "active",
        },
      ],
    });

    const postRemoveStore = openRuntimeSqliteStore({ rootDir: root });
    try {
      expect(postRemoveStore.listClaims()).toHaveLength(1);
      expect(postRemoveStore.listLocks()).toHaveLength(0);
      expect(postRemoveStore.listExecutionLogEntries()).toHaveLength(1);
    } finally {
      postRemoveStore.close();
    }
  });
});
