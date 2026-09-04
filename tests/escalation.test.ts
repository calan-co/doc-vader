import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import os from "node:os";
import path from "node:path";
import {
  EscalationError,
  consumeEscalation,
  createEscalation,
  getEscalation,
  WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY,
} from "../lib/escalation/index.js";
import { SagaInterruption } from "../lib/work-management/saga.js";
import { planWorkItemCheck } from "../lib/work-management/index.js";
import { executeEscalatedWorkCheckUse, recoverEscalatedWorkCheckUses } from "../lib/work/escalation-use-saga.js";

const roots: string[] = [];
const cliPath = path.resolve(process.cwd(), "cli/doc-vader.ts");
const tsxImport = path.resolve(process.cwd(), "node_modules/tsx/dist/loader.mjs");

function runCli(rootDir: string, args: string[]): string {
  const result = runCliResult(rootDir, args);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}

function runCliResult(rootDir: string, args: string[]) {
  return spawnSync(process.execPath, ["--import", tsxImport, cliPath, ...args], { cwd: rootDir, encoding: "utf8" });
}

function git(rootDir: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: rootDir, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-escalation-"));
  roots.push(directory);
  return directory;
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    scope: ["wi-100"],
    operation: "running-checklist-composition",
    composition: { checklistId: "tasks", checkId: "1-do-the-thing", action: "complete" },
    maxUses: 1,
    ...overrides,
  };
}

async function runningClaimedWork() {
  const rootDir = await root();
  git(rootDir, ["init"]);
  git(rootDir, ["config", "user.email", "test@example.com"]);
  git(rootDir, ["config", "user.name", "Test"]);
  await fs.mkdir(path.join(rootDir, "backlog"), { recursive: true });
  const workItemPath = path.join(rootDir, "backlog/100.md");
  await fs.writeFile(workItemPath, `---
id: wi-100
title: Escalated work
type: work-item
subtype: task
lifecycle: active
status: ready
tags: []
---

## Tasks

- [ ] Do the thing
`, "utf8");
  git(rootDir, ["add", "."]);
  git(rootDir, ["commit", "-m", "fixture"]);
  const claim = JSON.parse(runCli(rootDir, ["work", "wi-100", "claim", "create", "--holder", "test", "--json"]));
  runCli(rootDir, ["work", "wi-100", "update", "--input", '{"status":"running"}', "--claim", claim.claimToken, "--json"]);
  return { rootDir, workItemPath, claim };
}

async function plan(rootDir: string, claimToken: string) {
  return planWorkItemCheck({
    rootDir, id: "wi-100", checklistId: "tasks", checkId: "1-do-the-thing", action: "complete", claimToken,
  });
}

function deleteClaimWhileHoldingRuntimeWriteLock(databasePath: string, claimToken: string) {
  let resolveLocked!: () => void;
  let rejectLocked!: (error: Error) => void;
  let resolveCompleted!: () => void;
  let rejectCompleted!: (error: Error) => void;
  const locked = new Promise<void>((resolve, reject) => { resolveLocked = resolve; rejectLocked = reject; });
  const completed = new Promise<void>((resolve, reject) => { resolveCompleted = resolve; rejectCompleted = reject; });
  const worker = new Worker(`
    const { parentPort, workerData } = require("node:worker_threads");
    const { DatabaseSync } = require("node:sqlite");
    const database = new DatabaseSync(workerData.databasePath, { timeout: 5_000 });
    database.exec("BEGIN IMMEDIATE");
    parentPort.postMessage("locked");
    setTimeout(() => {
      database.prepare("DELETE FROM claims WHERE claim_token = ?").run(workerData.claimToken);
      database.exec("COMMIT");
      database.close();
      parentPort.postMessage("completed");
    }, 100);
  `, { eval: true, workerData: { databasePath, claimToken } });
  worker.on("message", (message: string) => {
    if (message === "locked") resolveLocked();
    if (message === "completed") resolveCompleted();
  });
  worker.on("error", (error) => { rejectLocked(error); rejectCompleted(error); });
  worker.on("exit", (code) => {
    if (code !== 0) {
      const error = new Error(`Claim writer exited with ${code}.`);
      rejectLocked(error);
      rejectCompleted(error);
    }
  });
  return { locked, completed };
}

describe("bounded DV-native escalations", () => {
  it("persists the sole registered policy and consumes its bounded scope once", async () => {
    const rootDir = await root();
    const escalation = createEscalation({
      rootDir,
      policy: WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY,
      payload: payload(),
    });

    expect(getEscalation({ rootDir, escalationId: escalation.id })).toMatchObject({
      id: escalation.id,
      policy: WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY,
      uses: 0,
      payload: payload(),
    });
    expect(consumeEscalation({ rootDir, escalationId: escalation.id, workItemId: "wi-100" })).toMatchObject({ uses: 1 });
    expect(() => consumeEscalation({ rootDir, escalationId: escalation.id, workItemId: "wi-100" })).toThrow(EscalationError);
    expect(getEscalation({ rootDir, escalationId: escalation.id })).toMatchObject({ uses: 1, consumptionEvents: [{ workItemId: "wi-100" }] });
  });

  it("recovers a fresh process interrupted after reservation by releasing only a provably absent Work mutation", async () => {
    const { rootDir, workItemPath, claim } = await runningClaimedWork();
    const escalation = createEscalation({ rootDir, policy: WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY, payload: payload() });

    await expect(executeEscalatedWorkCheckUse({
      rootDir, escalation, claimToken: claim.claimToken, plan: await plan(rootDir, claim.claimToken),
      afterBoundary: (boundary) => { if (boundary === "reserved") throw new SagaInterruption("process stopped"); },
    })).rejects.toThrow("process stopped");
    expect(getEscalation({ rootDir, escalationId: escalation.id })).toMatchObject({ uses: 0, consumptionEvents: [] });
    const database = new DatabaseSync(path.join(rootDir, ".doc-vader/runtime/runtime.sqlite"));
    expect(database.prepare("SELECT escalation_id, scope, claim_token, work_mutation_id, expected_work_revision, expected_work_hash, desired_work_hash, phase FROM escalation_use_operations").get()).toMatchObject({
      escalation_id: escalation.id, scope: '["wi-100"]', claim_token: claim.claimToken,
      work_mutation_id: expect.any(String), expected_work_revision: expect.any(String),
      expected_work_hash: expect.stringMatching(/^[a-f0-9]{64}$/), desired_work_hash: expect.stringMatching(/^[a-f0-9]{64}$/), phase: "reserved",
    });
    database.close();

    await recoverEscalatedWorkCheckUses({ rootDir, escalationId: escalation.id });
    expect(await fs.readFile(workItemPath, "utf8")).toContain("- [ ] Do the thing");
    await expect(executeEscalatedWorkCheckUse({ rootDir, escalation, claimToken: claim.claimToken, plan: await plan(rootDir, claim.claimToken) }))
      .resolves.toMatchObject({ escalation: { uses: 1 } });
  });

  it("recovers a fresh process after Work mutation before finalization without double use or unaudited success", async () => {
    const { rootDir, workItemPath, claim } = await runningClaimedWork();
    const escalation = createEscalation({ rootDir, policy: WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY, payload: payload() });

    await expect(executeEscalatedWorkCheckUse({
      rootDir, escalation, claimToken: claim.claimToken, plan: await plan(rootDir, claim.claimToken),
      afterBoundary: (boundary) => { if (boundary === "mutation-applied") throw new SagaInterruption("process stopped"); },
    })).rejects.toThrow("process stopped");
    expect(await fs.readFile(workItemPath, "utf8")).toContain("- [x] Do the thing");
    expect(getEscalation({ rootDir, escalationId: escalation.id })).toMatchObject({ uses: 0, consumptionEvents: [] });

    await recoverEscalatedWorkCheckUses({ rootDir, escalationId: escalation.id });
    await recoverEscalatedWorkCheckUses({ rootDir, escalationId: escalation.id });
    expect(getEscalation({ rootDir, escalationId: escalation.id })).toMatchObject({ uses: 1, consumptionEvents: [{ workItemId: "wi-100" }] });
    await expect(executeEscalatedWorkCheckUse({ rootDir, escalation, claimToken: claim.claimToken, plan: await plan(rootDir, claim.claimToken) }))
      .rejects.toMatchObject({ code: "ESCALATION_EXHAUSTED" });
  });

  it("disputes a fresh-process applied recovery after its original claim rotates", async () => {
    const { rootDir, workItemPath, claim } = await runningClaimedWork();
    const escalation = createEscalation({ rootDir, policy: WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY, payload: payload() });
    await expect(executeEscalatedWorkCheckUse({
      rootDir, escalation, claimToken: claim.claimToken, plan: await plan(rootDir, claim.claimToken),
      afterBoundary: (boundary) => { if (boundary === "mutation-applied") throw new SagaInterruption("process stopped"); },
    })).rejects.toThrow("process stopped");
    const database = new DatabaseSync(path.join(rootDir, ".doc-vader/runtime/runtime.sqlite"));
    database.exec("BEGIN; PRAGMA defer_foreign_keys = ON;");
    database.prepare("UPDATE claims SET claim_token = 'rotated-claim', holder = 'replacement' WHERE claim_token = ?").run(claim.claimToken);
    database.prepare("UPDATE locks SET claim_token = 'rotated-claim' WHERE claim_token = ?").run(claim.claimToken);
    database.prepare("UPDATE claim_scope_locks SET claim_token = 'rotated-claim' WHERE claim_token = ?").run(claim.claimToken);
    database.exec("COMMIT;");
    database.close();

    await expect(recoverEscalatedWorkCheckUses({ rootDir, escalationId: escalation.id })).rejects.toThrow("disputed");
    expect(await fs.readFile(workItemPath, "utf8")).toContain("- [x] Do the thing");
    expect(getEscalation({ rootDir, escalationId: escalation.id })).toMatchObject({ uses: 0, consumptionEvents: [] });
    expect(() => consumeEscalation({ rootDir, escalationId: escalation.id, workItemId: "wi-100" })).toThrow(EscalationError);
  });

  it("disputes expired reservations before effect and permits only an effect proven valid before finalization", async () => {
    const beforeEffect = await runningClaimedWork();
    const expiredBeforeEffect = createEscalation({
      rootDir: beforeEffect.rootDir,
      policy: WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY,
      payload: payload({ maxUses: undefined, expiresAt: "2099-01-01T00:00:00.000Z" }),
    });
    await expect(executeEscalatedWorkCheckUse({
      rootDir: beforeEffect.rootDir, escalation: expiredBeforeEffect, claimToken: beforeEffect.claim.claimToken,
      plan: await plan(beforeEffect.rootDir, beforeEffect.claim.claimToken),
      afterBoundary: (boundary) => {
        if (boundary === "mutation-intent") {
          const database = new DatabaseSync(path.join(beforeEffect.rootDir, ".doc-vader/runtime/runtime.sqlite"));
          database.prepare("UPDATE escalations SET payload = json_set(payload, '$.expiresAt', '2000-01-01T00:00:00.000Z') WHERE id = ?").run(expiredBeforeEffect.id);
          database.close();
        }
      },
    })).rejects.toMatchObject({ code: "ESCALATION_EXPIRED" });
    expect(await fs.readFile(beforeEffect.workItemPath, "utf8")).toContain("- [ ] Do the thing");
    await expect(recoverEscalatedWorkCheckUses({ rootDir: beforeEffect.rootDir, escalationId: expiredBeforeEffect.id })).rejects.toThrow("disputed");
    expect(() => consumeEscalation({ rootDir: beforeEffect.rootDir, escalationId: expiredBeforeEffect.id, workItemId: "wi-100" })).toThrow(EscalationError);

    const beforeFinalization = await runningClaimedWork();
    const expiredAfterEffect = createEscalation({
      rootDir: beforeFinalization.rootDir,
      policy: WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY,
      payload: payload({ maxUses: undefined, expiresAt: "2099-01-01T00:00:00.000Z" }),
    });
    await expect(executeEscalatedWorkCheckUse({
      rootDir: beforeFinalization.rootDir, escalation: expiredAfterEffect, claimToken: beforeFinalization.claim.claimToken,
      plan: await plan(beforeFinalization.rootDir, beforeFinalization.claim.claimToken),
      afterBoundary: (boundary) => {
        if (boundary === "mutation-applied") {
          const database = new DatabaseSync(path.join(beforeFinalization.rootDir, ".doc-vader/runtime/runtime.sqlite"));
          database.prepare("UPDATE escalations SET payload = json_set(payload, '$.expiresAt', '2000-01-01T00:00:00.000Z') WHERE id = ?").run(expiredAfterEffect.id);
          database.close();
        }
      },
    })).resolves.toMatchObject({ escalation: { uses: 1 } });
    expect(await fs.readFile(beforeFinalization.workItemPath, "utf8")).toContain("- [x] Do the thing");
  });

  it("retains an expiry-only disputed reservation and blocks unbounded public reuse", async () => {
    const { rootDir, claim } = await runningClaimedWork();
    const escalation = createEscalation({
      rootDir,
      policy: WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY,
      payload: payload({ maxUses: undefined, expiresAt: "2099-01-01T00:00:00.000Z" }),
    });
    await expect(executeEscalatedWorkCheckUse({
      rootDir, escalation, claimToken: claim.claimToken, plan: await plan(rootDir, claim.claimToken),
      afterBoundary: (boundary) => { if (boundary === "reserved") throw new SagaInterruption("process stopped"); },
    })).rejects.toThrow("process stopped");
    const database = new DatabaseSync(path.join(rootDir, ".doc-vader/runtime/runtime.sqlite"));
    database.prepare("UPDATE escalations SET payload = json_set(payload, '$.expiresAt', '2000-01-01T00:00:00.000Z') WHERE id = ?").run(escalation.id);
    database.close();

    await expect(recoverEscalatedWorkCheckUses({ rootDir, escalationId: escalation.id })).rejects.toThrow("disputed");
    expect(() => consumeEscalation({ rootDir, escalationId: escalation.id, workItemId: "wi-100" })).toThrow(EscalationError);
  });

  it("persists an ambiguous recovery dispute and blocks reuse", async () => {
    const { rootDir, workItemPath, claim } = await runningClaimedWork();
    const escalation = createEscalation({ rootDir, policy: WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY, payload: payload() });
    await expect(executeEscalatedWorkCheckUse({
      rootDir, escalation, claimToken: claim.claimToken, plan: await plan(rootDir, claim.claimToken),
      afterBoundary: (boundary) => { if (boundary === "reserved") throw new SagaInterruption("process stopped"); },
    })).rejects.toThrow("process stopped");
    await fs.writeFile(workItemPath, "external drift", "utf8");

    await expect(recoverEscalatedWorkCheckUses({ rootDir, escalationId: escalation.id })).rejects.toThrow("disputed");
    await expect(recoverEscalatedWorkCheckUses({ rootDir, escalationId: escalation.id })).rejects.toThrow("disputed");
    expect(() => consumeEscalation({ rootDir, escalationId: escalation.id, workItemId: "wi-100" })).toThrow(EscalationError);
  });

  it("exposes creation and inspection through the DV command surface", async () => {
    const rootDir = await root();
    const created = JSON.parse(runCli(rootDir, [
      "escalation", "create", "--policy", WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY,
      "--payload", JSON.stringify(payload()), "--json",
    ]));

    expect(JSON.parse(runCli(rootDir, ["escalation", created.id, "show", "--json"]))).toMatchObject({
      id: created.id,
      policy: WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY,
      uses: 0,
    });
  });

  it("consumes through a claimed running Work Item update", async () => {
    const rootDir = await root();
    git(rootDir, ["init"]);
    git(rootDir, ["config", "user.email", "test@example.com"]);
    git(rootDir, ["config", "user.name", "Test"]);
    await fs.mkdir(path.join(rootDir, "backlog"), { recursive: true });
    await fs.writeFile(path.join(rootDir, "backlog/100.md"), `---
id: wi-100
title: Escalated work
type: work-item
subtype: task
lifecycle: active
status: ready
tags: []
---

## Tasks

- [ ] Do the thing
`, "utf8");
    git(rootDir, ["add", "."]);
    git(rootDir, ["commit", "-m", "fixture"]);

    const claim = JSON.parse(runCli(rootDir, ["work", "wi-100", "claim", "create", "--holder", "test", "--json"]));
    runCli(rootDir, ["work", "wi-100", "update", "--input", '{"status":"running"}', "--claim", claim.claimToken, "--json"]);
    const escalation = JSON.parse(runCli(rootDir, [
      "escalation", "create", "--policy", WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY,
      "--payload", JSON.stringify(payload()), "--json",
    ]));

    expect(JSON.parse(runCli(rootDir, ["work", "wi-100", "update", "--escalation", escalation.id, "--claim", claim.claimToken, "--json"]))).toMatchObject({
      workItemId: "wi-100",
      escalation: { id: escalation.id, uses: 1 },
    });
    expect(await fs.readFile(path.join(rootDir, "backlog/100.md"), "utf8")).toContain("- [x] Do the thing");
    expect(JSON.parse(runCli(rootDir, ["escalation", escalation.id, "show", "--json"]))).toMatchObject({
      consumptionEvents: [{ workItemId: "wi-100" }],
    });
  });

  it("does not use an escalation for an invalid claim or failed Work mutation", async () => {
    const rootDir = await root();
    git(rootDir, ["init"]);
    git(rootDir, ["config", "user.email", "test@example.com"]);
    git(rootDir, ["config", "user.name", "Test"]);
    await fs.mkdir(path.join(rootDir, "backlog"), { recursive: true });
    const workItemPath = path.join(rootDir, "backlog/100.md");
    await fs.writeFile(workItemPath, `---
id: wi-100
title: Escalated work
type: work-item
subtype: task
lifecycle: active
status: ready
tags: []
---

## Tasks

- [ ] Do the thing
`, "utf8");
    git(rootDir, ["add", "."]);
    git(rootDir, ["commit", "-m", "fixture"]);
    const claim = JSON.parse(runCli(rootDir, ["work", "wi-100", "claim", "create", "--holder", "test", "--json"]));
    runCli(rootDir, ["work", "wi-100", "update", "--input", '{"status":"running"}', "--claim", claim.claimToken, "--json"]);

    const invalidClaimEscalation = createEscalation({ rootDir, policy: WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY, payload: payload() });
    expect(runCliResult(rootDir, ["work", "wi-100", "update", "--escalation", invalidClaimEscalation.id, "--claim", "wrong-claim", "--json"]).status).not.toBe(0);
    expect(getEscalation({ rootDir, escalationId: invalidClaimEscalation.id })).toMatchObject({ uses: 0, consumptionEvents: [] });
    expect(consumeEscalation({ rootDir, escalationId: invalidClaimEscalation.id, workItemId: "wi-100" })).toMatchObject({ uses: 1 });

    const failedMutationEscalation = createEscalation({
      rootDir, policy: WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY,
      payload: payload({ composition: { checklistId: "tasks", checkId: "missing", action: "complete" } }),
    });
    expect(runCliResult(rootDir, ["work", "wi-100", "update", "--escalation", failedMutationEscalation.id, "--claim", claim.claimToken, "--json"]).status).not.toBe(0);
    expect(getEscalation({ rootDir, escalationId: failedMutationEscalation.id })).toMatchObject({ uses: 0, consumptionEvents: [] });

    const expiredClaimEscalation = createEscalation({ rootDir, policy: WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY, payload: payload() });
    const database = new DatabaseSync(path.join(rootDir, ".doc-vader/runtime/runtime.sqlite"));
    database.prepare("UPDATE claims SET expires_at = '2000-01-01T00:00:00.000Z' WHERE claim_token = ?").run(claim.claimToken);
    database.close();
    expect(runCliResult(rootDir, ["work", "wi-100", "update", "--escalation", expiredClaimEscalation.id, "--claim", claim.claimToken, "--json"]).status).not.toBe(0);
    expect(getEscalation({ rootDir, escalationId: expiredClaimEscalation.id })).toMatchObject({ uses: 0, consumptionEvents: [] });
  });

  it("does not consume when the original claim is removed or replaced at the finalization boundary", async () => {
    for (const changeClaim of [
      (database: DatabaseSync, claimToken: string) => database.prepare("DELETE FROM claims WHERE claim_token = ?").run(claimToken),
      (database: DatabaseSync, claimToken: string) => {
        database.exec("BEGIN; PRAGMA defer_foreign_keys = ON;");
        database.prepare("UPDATE claims SET claim_token = 'replacement-claim', holder = 'replacement' WHERE claim_token = ?").run(claimToken);
        database.prepare("UPDATE locks SET claim_token = 'replacement-claim' WHERE claim_token = ?").run(claimToken);
        database.prepare("UPDATE claim_scope_locks SET claim_token = 'replacement-claim' WHERE claim_token = ?").run(claimToken);
        database.exec("COMMIT;");
      },
    ]) {
      const { rootDir, workItemPath, claim } = await runningClaimedWork();
      const escalation = createEscalation({ rootDir, policy: WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY, payload: payload() });
      await expect(executeEscalatedWorkCheckUse({
        rootDir, escalation, claimToken: claim.claimToken, plan: await plan(rootDir, claim.claimToken),
        afterBoundary: (boundary) => {
          if (boundary === "mutation-applied") {
            const database = new DatabaseSync(path.join(rootDir, ".doc-vader/runtime/runtime.sqlite"));
            try { changeClaim(database, claim.claimToken); } finally { database.close(); }
          }
        },
      })).rejects.toThrow();
      expect(await fs.readFile(workItemPath, "utf8")).toContain("- [x] Do the thing");
      expect(getEscalation({ rootDir, escalationId: escalation.id })).toMatchObject({ uses: 0, consumptionEvents: [] });
      const database = new DatabaseSync(path.join(rootDir, ".doc-vader/runtime/runtime.sqlite"));
      try {
        expect(database.prepare("SELECT COUNT(*) AS count FROM escalation_uses WHERE escalation_id = ?").get(escalation.id)).toMatchObject({ count: 0 });
      } finally {
        database.close();
      }
      expect(() => consumeEscalation({ rootDir, escalationId: escalation.id, workItemId: "wi-100" })).toThrow(EscalationError);
    }
  });

  it("does not consume when a competing runtime connection deletes the claim at finalization", async () => {
    const { rootDir, workItemPath, claim } = await runningClaimedWork();
    const escalation = createEscalation({ rootDir, policy: WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY, payload: payload() });
    let writer: ReturnType<typeof deleteClaimWhileHoldingRuntimeWriteLock> | undefined;
    await expect(executeEscalatedWorkCheckUse({
      rootDir, escalation, claimToken: claim.claimToken, plan: await plan(rootDir, claim.claimToken),
      afterBoundary: async (boundary) => {
        if (boundary !== "mutation-applied") return;
        writer = deleteClaimWhileHoldingRuntimeWriteLock(path.join(rootDir, ".doc-vader/runtime/runtime.sqlite"), claim.claimToken);
        await writer.locked;
      },
    })).rejects.toMatchObject({ code: "ESCALATION_USE_OPERATION_AUTHORITY_INVALID" });
    await writer!.completed;
    expect(await fs.readFile(workItemPath, "utf8")).toContain("- [x] Do the thing");
    expect(getEscalation({ rootDir, escalationId: escalation.id })).toMatchObject({ uses: 0, consumptionEvents: [] });
  });

  it("disputes an expired absent reservation after a file-command failure and blocks reuse", async () => {
    const { rootDir, workItemPath, claim } = await runningClaimedWork();
    const escalation = createEscalation({
      rootDir,
      policy: WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY,
      payload: payload({ maxUses: undefined, expiresAt: "2099-01-01T00:00:00.000Z" }),
    });
    await expect(executeEscalatedWorkCheckUse({
      rootDir, escalation, claimToken: claim.claimToken, plan: await plan(rootDir, claim.claimToken),
      afterBoundary: async (boundary) => {
        if (boundary !== "effect-begun") return;
        const database = new DatabaseSync(path.join(rootDir, ".doc-vader/runtime/runtime.sqlite"));
        try {
          database.prepare("UPDATE escalations SET payload = json_set(payload, '$.expiresAt', '2000-01-01T00:00:00.000Z') WHERE id = ?").run(escalation.id);
        } finally {
          database.close();
        }
        const sagaRoot = path.join(rootDir, ".doc-vader/runtime/sagas");
        const sagaId = (await fs.readdir(sagaRoot))[0]!;
        const stage = (await fs.readdir(path.join(sagaRoot, sagaId))).find((entry) => entry.endsWith(".next"));
        await fs.rm(path.join(sagaRoot, sagaId, stage!));
      },
    })).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(workItemPath, "utf8")).toContain("- [ ] Do the thing");
    expect(getEscalation({ rootDir, escalationId: escalation.id })).toMatchObject({ uses: 0, consumptionEvents: [] });
    const database = new DatabaseSync(path.join(rootDir, ".doc-vader/runtime/runtime.sqlite"));
    try {
      expect(database.prepare("SELECT phase FROM escalation_use_operations").get()).toMatchObject({ phase: "disputed" });
      expect(database.prepare("SELECT COUNT(*) AS count FROM escalation_reservations WHERE escalation_id = ?").get(escalation.id)).toMatchObject({ count: 1 });
    } finally {
      database.close();
    }
    expect(() => consumeEscalation({ rootDir, escalationId: escalation.id, workItemId: "wi-100" })).toThrow(EscalationError);
  });

  it("retains a bounded reservation when consumption finalization fails after the Work mutation", async () => {
    const rootDir = await root();
    git(rootDir, ["init"]);
    git(rootDir, ["config", "user.email", "test@example.com"]);
    git(rootDir, ["config", "user.name", "Test"]);
    await fs.mkdir(path.join(rootDir, "backlog"), { recursive: true });
    const workItemPath = path.join(rootDir, "backlog/100.md");
    await fs.writeFile(workItemPath, `---
id: wi-100
title: Escalated work
type: work-item
subtype: task
lifecycle: active
status: ready
tags: []
---

## Tasks

- [ ] Do the thing
`, "utf8");
    git(rootDir, ["add", "."]);
    git(rootDir, ["commit", "-m", "fixture"]);
    const claim = JSON.parse(runCli(rootDir, ["work", "wi-100", "claim", "create", "--holder", "test", "--json"]));
    runCli(rootDir, ["work", "wi-100", "update", "--input", '{"status":"running"}', "--claim", claim.claimToken, "--json"]);
    const escalation = createEscalation({ rootDir, policy: WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY, payload: payload() });
    const database = new DatabaseSync(path.join(rootDir, ".doc-vader/runtime/runtime.sqlite"));
    database.exec("CREATE TRIGGER fail_escalation_finalize BEFORE INSERT ON escalation_uses BEGIN SELECT RAISE(ABORT, 'forced'); END;");
    database.close();

    expect(runCliResult(rootDir, ["work", "wi-100", "update", "--escalation", escalation.id, "--claim", claim.claimToken, "--json"]).status).not.toBe(0);
    expect(await fs.readFile(workItemPath, "utf8")).toContain("- [x] Do the thing");
    expect(getEscalation({ rootDir, escalationId: escalation.id })).toMatchObject({ uses: 0, consumptionEvents: [] });
    expect(() => consumeEscalation({ rootDir, escalationId: escalation.id, workItemId: "wi-100" })).toThrow(EscalationError);
  });

  it("fails closed for unknown policy, missing scope, expired, and out-of-scope payloads", async () => {
    const rootDir = await root();
    expect(() => createEscalation({ rootDir, policy: "unknown", payload: payload() })).toThrow(EscalationError);
    expect(() => createEscalation({ rootDir, policy: WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY, payload: payload({ scope: [] }) })).toThrow(EscalationError);

    const expired = createEscalation({
      rootDir,
      policy: WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY,
      payload: payload({ maxUses: undefined, expiresAt: "2000-01-01T00:00:00.000Z" }),
    });
    const scoped = createEscalation({ rootDir, policy: WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY, payload: payload() });

    expect(() => consumeEscalation({ rootDir, escalationId: expired.id, workItemId: "wi-100" })).toThrow(EscalationError);
    expect(() => consumeEscalation({ rootDir, escalationId: scoped.id, workItemId: "wi-101" })).toThrow(EscalationError);
    expect(getEscalation({ rootDir, escalationId: expired.id })).toMatchObject({ uses: 0, consumptionEvents: [] });
    expect(getEscalation({ rootDir, escalationId: scoped.id })).toMatchObject({ uses: 0, consumptionEvents: [] });
  });
});
