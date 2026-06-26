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

async function writeTask(
  root: string,
  fileName: string,
  body = "## Acceptance Criteria\n\n- [ ] Do the thing\n",
): Promise<void> {
  await fs.mkdir(path.join(root, "backlog"), { recursive: true });
  await fs.writeFile(
    path.join(root, "backlog", fileName),
    `---\nid: wi-${path.basename(fileName, ".md")}\ntitle: ${path.basename(fileName, ".md")}\nsummary: ${path.basename(fileName, ".md")}\ntype: work-item\nsubtype: story\nlifecycle: active\nstatus: ready\nstatus_reason: auto\ntags:\n  - afk\n---\n\n${body}`,
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
tags:
  - afk`,
        "## Acceptance Criteria\n\n- [x] Do the thing\n",
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
          "task",
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
tags:
  - afk`,
        "## Acceptance Criteria\n\n- [x] Do the thing\n",
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
          "task",
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

  it("aliases task claim to runtime claim creation", async () => {
    const root = await mkRoot();
    try {
      await writeTask(root, "60373-alias.md");

      const created = JSON.parse(
        runCli(root, [
          "task",
          "claim",
          "60373-alias",
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
