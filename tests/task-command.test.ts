import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  claimTask,
  getClaimStatus,
  listTaskClaims,
  recoverClaim,
  releaseClaim,
} from "../lib/task/claims.js";
import { loadTaskModel } from "../lib/task/model.js";
import { selectReadyTasks } from "../lib/task/ready.js";
import {
  recordTaskEvidence,
  validateTaskRecordPayload,
} from "../lib/task/record.js";
import { renderTaskPrompt } from "../lib/task/render.js";
import {
  transitionTask,
  validateTaskTransitionPayload,
} from "../lib/task/transition.js";

const cliPath = path.resolve(__dirname, "../cli/doc-vader.ts");
const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;

async function mkTmpRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-task-"));
  await fs.mkdir(path.join(root, "backlog"), { recursive: true });
  await fs.mkdir(path.join(root, ".doc-vader"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".doc-vader/backlog-consumer.json"),
    JSON.stringify(
      {
        roots: {
          backlog: "backlog",
          active: "backlog",
          archive: "backlog/archive",
          records: "backlog/records",
          audit: "backlog/audit",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.mkdir(path.join(root, "templates/reference/task"), {
    recursive: true,
  });
  await fs.copyFile(
    path.resolve(__dirname, "../templates/reference/task/show.md.tpl"),
    path.join(root, "templates/reference/task/show.md.tpl"),
  );
  await fs.copyFile(
    path.resolve(__dirname, "../templates/reference/task/prompt.md.tpl"),
    path.join(root, "templates/reference/task/prompt.md.tpl"),
  );
  return root;
}

function claimStorePath(root: string): string {
  return path.join(root, ".doc-vader", "task-claims.json");
}

async function writeTask(
  root: string,
  fileName: string,
  frontmatter: string,
  body = "## Acceptance criteria\n\n- [ ] Do the thing\n",
): Promise<void> {
  await fs.writeFile(
    path.join(root, "backlog", fileName),
    `---\n${frontmatter.trim()}\n---\n\n${body}`,
    "utf8",
  );
}

function runCli(
  root: string,
  args: string[],
  input?: string,
  env?: NodeJS.ProcessEnv,
): string {
  return execFileSync("node", ["--import", tsxImport, cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    input,
    env: {
      ...process.env,
      DOC_VADER_TASK_CLAIM_STORE: claimStorePath(root),
      ...env,
    },
  });
}

describe("task command surface", () => {
  it("loads deterministic canonical task JSON", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "100-sample-task.md",
        `id: wi-100
title: Sample Task
summary: Stable task JSON
type: work-item
subtype: story
lifecycle: active
status: ready
status_reason: auto
priority: critical
estimated: 2
tags:
  - afk
links:
  reference:
    - '[[reference-one]]'`,
      );

      const task = await loadTaskModel("100", { rootDir: root });

      expect(task).toMatchObject({
        id: "wi-100",
        numericId: "100",
        title: "Sample Task",
        filePath: "backlog/100-sample-task.md",
        status: "ready",
        lifecycle: "active",
        tags: ["afk"],
        validation: {
          isActive: true,
          isReady: true,
          isAfk: true,
          isHitl: false,
          dependenciesSatisfied: true,
        },
      });
      expect(task.acceptanceCriteria).toEqual([
        { checked: false, text: "Do the thing" },
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("renders prompts from the canonical task model", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "101-prompt-task.md",
        `id: wi-101
title: Prompt Task
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );

      const task = await loadTaskModel("wi-101", { rootDir: root });
      const prompt = await renderTaskPrompt(task, { rootDir: root });

      expect(prompt).toContain("Implement wi-101: Prompt Task");
      expect(prompt).toContain("Use `dv task show wi-101 --json`");
      expect(prompt).toContain("Templjs rendering is presentation only");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed for missing, ambiguous, and archived task ids", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "102-a.md",
        `id: wi-102
title: A
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      await writeTask(
        root,
        "102-b.md",
        `id: wi-102b
title: B
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      await fs.mkdir(path.join(root, "backlog/archive"), { recursive: true });
      await fs.rename(
        path.join(root, "backlog", "102-a.md"),
        path.join(root, "backlog/archive", "102-a.md"),
      );

      await expect(loadTaskModel("missing", { rootDir: root })).rejects.toMatchObject({
        code: "TASK_NOT_FOUND",
      });
      await expect(loadTaskModel("102", { rootDir: root })).rejects.toMatchObject({
        code: "TASK_AMBIGUOUS",
      });
      await expect(loadTaskModel("wi-102", { rootDir: root })).rejects.toMatchObject({
        code: "TASK_ARCHIVED",
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("creates, reports, conflicts, and releases local claims", async () => {
    const root = await mkTmpRoot();
    try {
      const now = new Date("2026-06-15T12:00:00.000Z");
      const claim = await claimTask("wi-103", {
        rootDir: root,
        claimStorePath: claimStorePath(root),
        holder: "agent-a",
        now,
      });

      expect(claim.state).toBe("active");
      await expect(
        claimTask("wi-103", {
          rootDir: root,
          claimStorePath: claimStorePath(root),
          holder: "agent-b",
          now,
        }),
      ).rejects.toMatchObject({ code: "TASK_CLAIM_CONFLICT" });
      await expect(
        getClaimStatus(claim.claimId, {
          rootDir: root,
          claimStorePath: claimStorePath(root),
          now,
        }),
      )
        .resolves.toMatchObject({ state: "active", taskId: "wi-103" });
      await expect(
        releaseClaim(claim.claimId, {
          rootDir: root,
          claimStorePath: claimStorePath(root),
          now,
        }),
      )
        .resolves.toMatchObject({ state: "released", taskId: "wi-103" });
      await expect(
        getClaimStatus("claim-missing", {
          rootDir: root,
          claimStorePath: claimStorePath(root),
          now,
        }),
      )
        .resolves.toMatchObject({ state: "missing" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("supports a shared claim store path for sandbox mutexes", async () => {
    const root = await mkTmpRoot();
    const otherRoot = await mkTmpRoot();
    const sharedClaimStore = path.join(root, "shared", "task-claims.json");
    try {
      const claim = await claimTask("wi-104", {
        rootDir: root,
        claimStorePath: sharedClaimStore,
        holder: "agent-a",
      });

      await expect(
        claimTask("wi-104", {
          rootDir: otherRoot,
          claimStorePath: sharedClaimStore,
          holder: "agent-b",
        }),
      ).rejects.toMatchObject({ code: "TASK_CLAIM_CONFLICT" });
      await expect(
        getClaimStatus(claim.claimId, {
          rootDir: otherRoot,
          claimStorePath: sharedClaimStore,
        }),
      ).resolves.toMatchObject({ state: "active", taskId: "wi-104" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(otherRoot, { recursive: true, force: true });
    }
  });

  it("uses configured claim store path when no explicit override is provided", async () => {
    const root = await mkTmpRoot();
    const otherRoot = await mkTmpRoot();
    const previousClaimStoreEnv = process.env.DOC_VADER_TASK_CLAIM_STORE;
    try {
      delete process.env.DOC_VADER_TASK_CLAIM_STORE;
      await fs.writeFile(
        path.join(root, ".doc-vader/backlog-consumer.json"),
        JSON.stringify(
          {
            roots: {
              backlog: "backlog",
              active: "backlog",
              archive: "backlog/archive",
              records: "backlog/records",
              audit: "backlog/audit",
            },
            task: {
              claimStorePath: path.join(root, "shared", "claims.json"),
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      await fs.writeFile(
        path.join(otherRoot, ".doc-vader/backlog-consumer.json"),
        JSON.stringify(
          {
            roots: {
              backlog: "backlog",
              active: "backlog",
              archive: "backlog/archive",
              records: "backlog/records",
              audit: "backlog/audit",
            },
            task: {
              claimStorePath: path.join(root, "shared", "claims.json"),
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const claim = await claimTask("wi-106", {
        rootDir: root,
        holder: "agent-a",
      });

      await expect(
        claimTask("wi-106", {
          rootDir: otherRoot,
          holder: "agent-b",
        }),
      ).rejects.toMatchObject({ code: "TASK_CLAIM_CONFLICT" });
      await expect(
        getClaimStatus(claim.claimId, { rootDir: otherRoot }),
      ).resolves.toMatchObject({ state: "active", taskId: "wi-106" });
    } finally {
      if (previousClaimStoreEnv === undefined) {
        delete process.env.DOC_VADER_TASK_CLAIM_STORE;
      } else {
        process.env.DOC_VADER_TASK_CLAIM_STORE = previousClaimStoreEnv;
      }
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(otherRoot, { recursive: true, force: true });
    }
  });

  it("reports expired claims without silently authorizing a replacement", async () => {
    const root = await mkTmpRoot();
    try {
      const claim = await claimTask("wi-104", {
        rootDir: root,
        claimStorePath: claimStorePath(root),
        holder: "agent-a",
        ttlMinutes: 1,
        now: new Date("2026-06-15T12:00:00.000Z"),
      });
      const later = new Date("2026-06-15T12:02:00.000Z");

      await expect(
        getClaimStatus(claim.claimId, {
          rootDir: root,
          claimStorePath: claimStorePath(root),
          now: later,
        }),
      )
        .resolves.toMatchObject({ state: "expired" });
      await expect(
        claimTask("wi-104", {
          rootDir: root,
          claimStorePath: claimStorePath(root),
          holder: "agent-b",
          now: later,
        }),
      ).rejects.toMatchObject({ code: "TASK_CLAIM_EXPIRED" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("classifies and recovers expired branch-aware claims", { timeout: 15_000 }, async () => {
    const root = await mkTmpRoot();
    try {
      execFileSync("git", ["init", "--initial-branch", "main"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync("git", ["config", "user.email", "agent@example.com"], {
        cwd: root,
      });
      execFileSync("git", ["config", "user.name", "Agent"], { cwd: root });
      await fs.writeFile(path.join(root, "README.md"), "base\n", "utf8");
      execFileSync("git", ["add", "README.md"], { cwd: root });
      execFileSync("git", ["commit", "-m", "chore: base"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync("git", ["switch", "-c", "sandcastle/issue-107"], {
        cwd: root,
        stdio: "ignore",
      });
      await fs.writeFile(path.join(root, "README.md"), "base\nwork\n", "utf8");
      execFileSync("git", ["add", "README.md"], { cwd: root });
      execFileSync("git", ["commit", "-m", "feat: work"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync("git", ["switch", "main"], { cwd: root, stdio: "ignore" });

      const claim = await claimTask("wi-107", {
        rootDir: root,
        claimStorePath: claimStorePath(root),
        holder: "agent-a",
        branch: "sandcastle/issue-107",
        baseRef: "HEAD",
        ttlMinutes: 1,
        now: new Date("2026-06-15T12:00:00.000Z"),
      });
      const later = new Date("2026-06-15T12:02:00.000Z");

      await expect(
        recoverClaim(claim.claimId, {
          rootDir: root,
          claimStorePath: claimStorePath(root),
          now: later,
        }),
      ).resolves.toMatchObject({
        state: "expired",
        classification: "adopt_recommended",
        git: {
          branch: "sandcastle/issue-107",
          branchExists: true,
          uniqueCommitCount: 1,
        },
      });
      await expect(
        recoverClaim(claim.claimId, {
          rootDir: root,
          claimStorePath: claimStorePath(root),
          action: "release",
          now: later,
        }),
      ).rejects.toMatchObject({ code: "TASK_RECOVERY_UNSAFE_RELEASE" });
      await expect(
        recoverClaim(claim.claimId, {
          rootDir: root,
          claimStorePath: claimStorePath(root),
          action: "adopt",
          holder: "agent-b",
          now: later,
        }),
      ).resolves.toMatchObject({
        state: "active",
        classification: "manual_review_required",
      });
      await expect(
        listTaskClaims({
          rootDir: root,
          claimStorePath: claimStorePath(root),
          now: later,
        }),
      ).resolves.toMatchObject([
        {
          claimId: claim.claimId,
          state: "active",
          claim: {
            holder: "agent-b",
            schemaVersion: "task-claim/v2",
            git: { branch: "sandcastle/issue-107" },
          },
        },
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("exposes show and claim through the CLI", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "105-cli-task.md",
        `id: wi-105
title: CLI Task
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );

      const show = JSON.parse(runCli(root, ["task", "show", "105", "--json"]));
      expect(show.id).toBe("wi-105");
      const claim = JSON.parse(
        runCli(root, [
          "task",
          "claim",
          "105",
          "--holder",
          "agent-a",
          "--json",
        ]),
      );
      expect(claim).toMatchObject({ taskId: "wi-105", state: "active" });
      const claimFor = JSON.parse(
        runCli(root, ["task", "claim-for", "105", "--json"]),
      );
      expect(claimFor).toMatchObject({
        claimId: claim.claimId,
        taskId: "wi-105",
        state: "active",
      });
      const released = JSON.parse(
        runCli(root, ["task", "release", "--claim", claim.claimId, "--json"]),
      );
      expect(released.state).toBe("released");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("selects ready tasks and reports structured deterministic exclusions", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "200-ready.md",
        `id: wi-200
title: Ready
type: work-item
lifecycle: active
status: ready
tags:
  - afk
links:
  depends_on:
    - '[[209-closed-dependency]]'`,
      );
      await writeTask(
        root,
        "201-hitl.md",
        `id: wi-201
title: HITL
type: work-item
lifecycle: active
status: ready
tags:
  - afk
  - hitl`,
      );
      await writeTask(
        root,
        "202-blocked.md",
        `id: wi-202
title: Blocked
type: work-item
lifecycle: active
status: ready
tags:
  - afk
links:
  depends_on:
    - '[[203-dependency]]'`,
      );
      await writeTask(
        root,
        "203-dependency.md",
        `id: wi-203
title: Dependency
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      await writeTask(
        root,
        "204-missing-classification.md",
        `id: wi-204
title: Missing Classification
type: work-item
lifecycle: active
status: ready
tags:
  - sandcastle`,
      );
      await writeTask(
        root,
        "205-invalid.md",
        `id: wi-205
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      await writeTask(
        root,
        "206-closed.md",
        `id: wi-206
title: Closed
type: work-item
lifecycle: inactive
status: closed
tags:
  - afk`,
      );
      await writeTask(
        root,
        "207-blocked.md",
        `id: wi-207
title: Blocked Status
type: work-item
lifecycle: active
status: blocked
tags:
  - afk`,
      );
      await fs.mkdir(path.join(root, "backlog/archive"), { recursive: true });
      await writeTask(
        root,
        "archive/208-archived.md",
        `id: wi-208
title: Archived
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      await writeTask(
        root,
        "209-closed-dependency.md",
        `id: wi-209
title: Closed Dependency
type: work-item
lifecycle: inactive
status: closed
tags:
  - afk`,
      );
      await writeTask(
        root,
        "210-dependency-blocked-status.md",
        `id: wi-210
title: Dependency Blocked Status
type: work-item
lifecycle: active
status: dependency-blocked
tags:
  - afk`,
      );
      await claimTask("wi-203", {
        rootDir: root,
        claimStorePath: claimStorePath(root),
        holder: "agent-a",
      });

      const report = await selectReadyTasks({
        rootDir: root,
        claimStorePath: claimStorePath(root),
      });

      expect(report.candidates.map((task) => task.id)).toEqual(["wi-200"]);
      expect(report.candidates[0]).toMatchObject({
        id: "wi-200",
        filePath: "backlog/200-ready.md",
        dependencies: [
          {
            id: "wi-209",
            satisfied: true,
            stateKnown: true,
          },
        ],
      });
      expect(
        report.exclusions.map((entry) => ({
          id: entry.id,
          codes: entry.reasons.map((reason) => reason.code),
        })),
      ).toEqual([
        { id: "wi-201", codes: ["hitl"] },
        { id: "wi-202", codes: ["dependency_blocked"] },
        { id: "wi-203", codes: ["task_claim_active"] },
        { id: "wi-204", codes: ["missing_classification"] },
        { id: "wi-205", codes: ["invalid"] },
        { id: "wi-206", codes: ["closed", "not_ready", "not_active"] },
        { id: "wi-207", codes: ["blocked", "not_ready"] },
        { id: "wi-209", codes: ["closed", "not_ready", "not_active"] },
        { id: "wi-210", codes: ["dependency_blocked", "not_ready"] },
        { id: "wi-208", codes: ["archived"] },
      ]);
      const porcelain = runCli(root, ["task", "ready", "--porcelain"]);
      expect(porcelain.trim()).toBe("wi-200\tbacklog/200-ready.md\tReady");
      const json = JSON.parse(runCli(root, ["task", "ready", "--json"]));
      expect(json.schemaVersion).toBe("task-ready/v1");
      expect(json.candidates).toHaveLength(1);
      expect(json.exclusions).toHaveLength(10);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("orders ready candidates by priority with file path tie-breaks", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "300-medium-b.md",
        `id: wi-300
title: Medium B
type: work-item
lifecycle: active
status: ready
priority: medium
tags:
  - afk`,
      );
      await writeTask(
        root,
        "301-critical.md",
        `id: wi-301
title: Critical
type: work-item
lifecycle: active
status: ready
priority: critical
tags:
  - afk`,
      );
      await writeTask(
        root,
        "302-low.md",
        `id: wi-302
title: Low
type: work-item
lifecycle: active
status: ready
priority: low
tags:
  - afk`,
      );
      await writeTask(
        root,
        "303-unknown.md",
        `id: wi-303
title: Unknown Priority
type: work-item
lifecycle: active
status: ready
priority: someday
tags:
  - afk`,
      );
      await writeTask(
        root,
        "304-high.md",
        `id: wi-304
title: High
type: work-item
lifecycle: active
status: ready
priority: high
tags:
  - afk`,
      );
      await writeTask(
        root,
        "299-medium-a.md",
        `id: wi-299
title: Medium A
type: work-item
lifecycle: active
status: ready
priority: medium
tags:
  - afk`,
      );
      await writeTask(
        root,
        "305-missing-priority.md",
        `id: wi-305
title: Missing Priority
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );

      const report = await selectReadyTasks({
        rootDir: root,
        claimStorePath: claimStorePath(root),
      });

      expect(report.candidates.map((task) => task.id)).toEqual([
        "wi-301",
        "wi-304",
        "wi-299",
        "wi-300",
        "wi-302",
        "wi-303",
        "wi-305",
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed for unknown dependency state and expired claims", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "204-expired.md",
        `id: wi-204
title: Expired
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      await writeTask(
        root,
        "205-missing-dependency.md",
        `id: wi-205
title: Missing Dependency
type: work-item
lifecycle: active
status: ready
tags:
  - afk
links:
  depends_on:
    - '[[999-missing]]'`,
      );
      await claimTask("wi-204", {
        rootDir: root,
        claimStorePath: claimStorePath(root),
        holder: "agent-a",
        ttlMinutes: -1,
      });

      const report = await selectReadyTasks({
        rootDir: root,
        claimStorePath: claimStorePath(root),
      });

      expect(report.candidates).toHaveLength(0);
      expect(
        report.exclusions.map((entry) => ({
          id: entry.id,
          codes: entry.reasons.map((reason) => reason.code),
        })),
      ).toEqual([
        { id: "wi-204", codes: ["task_claim_expired"] },
        { id: "wi-205", codes: ["dependency_state_unknown"] },
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("creates and links task evidence from a claim payload", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "205-record.md",
        `id: wi-205
title: Record
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      const claim = await claimTask("wi-205", {
        rootDir: root,
        claimStorePath: claimStorePath(root),
        holder: "agent-a",
      });

      const result = await recordTaskEvidence({
        rootDir: root,
        claimStorePath: claimStorePath(root),
        claimId: claim.claimId,
        payload: validateTaskRecordPayload({
          id: "record:wi-205-evidence",
          type: "test-result",
          subtype: "test-result",
          summary: "Task validation passed",
          observation: "Focused tests passed",
          outcome: "pass",
          artifactRefs: ["test-output"],
          supportingRefs: ["supporting-doc"],
          findings: ["No regressions"],
          notes: ["Recorded by task command"],
        }),
      });

      expect(result).toMatchObject({
        taskId: "wi-205",
        evidenceLink: "[[record-wi-205-evidence]]",
      });
      const workItem = await fs.readFile(
        path.join(root, "backlog/205-record.md"),
        "utf8",
      );
      expect(workItem).toContain("[[record-wi-205-evidence]]");
      await expect(
        fs.readFile(
          path.join(root, "backlog/records/record-wi-205-evidence.md"),
          "utf8",
        ),
      ).resolves.toContain("Focused tests passed");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("supports task record payloads from CLI file and stdin", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "206-record-cli.md",
        `id: wi-206
title: Record CLI
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      const claim = JSON.parse(
        runCli(root, ["task", "claim", "206", "--holder", "agent-a", "--json"]),
      );
      const payloadPath = path.join(root, "payload.json");
      await fs.writeFile(
        payloadPath,
        JSON.stringify({
          id: "record:wi-206-file",
          type: "test-result",
          summary: "File payload",
          observation: "File payload recorded",
          outcome: "pass",
        }),
      );
      const fileResult = JSON.parse(
        runCli(root, [
          "task",
          "record",
          "--claim",
          claim.claimId,
          "--payload",
          payloadPath,
          "--json",
        ]),
      );
      expect(fileResult.evidenceLink).toBe("[[record-wi-206-file]]");
      await runCli(root, ["task", "release", "--claim", claim.claimId, "--json"]);
      const secondClaim = JSON.parse(
        runCli(root, ["task", "claim", "206", "--holder", "agent-b", "--json"]),
      );
      const stdinResult = JSON.parse(
        runCli(
          root,
          [
            "task",
            "record",
            "--claim",
            secondClaim.claimId,
            "--payload",
            "-",
            "--json",
          ],
          JSON.stringify({
            id: "record:wi-206-stdin",
            type: "test-result",
            summary: "Stdin payload",
            observation: "Stdin payload recorded",
            outcome: "pass",
          }),
        ),
      );
      expect(stdinResult.evidenceLink).toBe("[[record-wi-206-stdin]]");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 15_000);

  it("fails record payloads and inactive claims before writing", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "207-record-fail.md",
        `id: wi-207
title: Record Fail
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      expect(() =>
        validateTaskRecordPayload({
          type: "test-result",
          observation: "missing summary",
        }),
      )
        .toThrowError(/summary/);
      await expect(
        recordTaskEvidence({
          rootDir: root,
          claimStorePath: claimStorePath(root),
          claimId: "claim-missing",
          payload: validateTaskRecordPayload({
            type: "test-result",
            summary: "Should not write",
            observation: "Missing claim",
          }),
        }),
      ).rejects.toMatchObject({ code: "TASK_RECORD_INVALID_CLAIM" });
      const orphanClaim = await claimTask("wi-999", {
        rootDir: root,
        claimStorePath: claimStorePath(root),
        holder: "agent-a",
      });
      await expect(
        recordTaskEvidence({
          rootDir: root,
          claimStorePath: claimStorePath(root),
          claimId: orphanClaim.claimId,
          payload: validateTaskRecordPayload({
            id: "record:should-not-write",
            type: "test-result",
            summary: "Should not write",
            observation: "Link preflight must fail first",
          }),
        }),
      ).rejects.toThrow("Unable to find work item 'wi-999'.");
      await expect(
        fs.stat(path.join(root, "backlog/records")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("transitions claimed tasks through the workflow profile", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "208-transition.md",
        `id: wi-208
title: Transition
type: work-item
lifecycle: active
status: ready
status_reason: auto
tags:
  - afk`,
        "## Acceptance Criteria\n\n- [x] Do the thing\n",
      );
      const claim = await claimTask("wi-208", {
        rootDir: root,
        claimStorePath: claimStorePath(root),
        holder: "agent-a",
      });

      const running = await transitionTask({
        rootDir: root,
        claimStorePath: claimStorePath(root),
        claimId: claim.claimId,
        status: "running",
        statusReason: "implementation",
      });

      expect(running).toMatchObject({
        taskId: "wi-208",
        fromStatus: "ready",
        toStatus: "running",
        matchedRuleId: "forward-ready-to-running",
      });
      const workItem = await fs.readFile(
        path.join(root, "backlog/208-transition.md"),
        "utf8",
      );
      expect(workItem).toContain("status: running");
      expect(workItem).toContain("status_reason: implementation");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("fails task completion without claim evidence", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "209-close-no-evidence.md",
        `id: wi-209
title: No Evidence
type: work-item
lifecycle: active
status: ready
status_reason: auto
tags:
  - afk`,
        "## Acceptance Criteria\n\n- [x] Do the thing\n",
      );
      const claim = await claimTask("wi-209", {
        rootDir: root,
        claimStorePath: claimStorePath(root),
        holder: "agent-a",
      });

      await expect(
        transitionTask({
          rootDir: root,
          claimStorePath: claimStorePath(root),
          claimId: claim.claimId,
          status: "completed",
          statusReason: "completed",
        }),
      ).rejects.toMatchObject({ code: "TASK_TRANSITION_MISSING_EVIDENCE" });
      const workItem = await fs.readFile(
        path.join(root, "backlog/209-close-no-evidence.md"),
        "utf8",
      );
      expect(workItem).toContain("status: ready");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("supports task close after evidence and rejects stale payload from_status", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "210-close.md",
        `id: wi-210
title: Close
type: work-item
lifecycle: active
status: ready
status_reason: auto
tags:
  - afk`,
        "## Acceptance Criteria\n\n- [x] Do the thing\n",
      );
      const claim = JSON.parse(
        runCli(root, ["task", "claim", "210", "--holder", "agent-a", "--json"]),
      );
      await runCli(
        root,
        [
          "task",
          "record",
          "--claim",
          claim.claimId,
          "--payload",
          "-",
          "--json",
        ],
        JSON.stringify({
          id: "record:wi-210-close",
          type: "test-result",
          summary: "Close validation",
          observation: "Evidence exists before close.",
          outcome: "pass",
        }),
      );

      expect(() =>
        validateTaskTransitionPayload({
          from_status: "running",
          to_status: "completed",
          to_status_reason: "completed",
        }),
      ).not.toThrow();
      expect(() =>
        runCli(
          root,
          [
            "task",
            "transition",
            "--claim",
            claim.claimId,
            "--payload",
            "-",
            "--json",
          ],
          JSON.stringify({
            from_status: "running",
            to_status: "completed",
            to_status_reason: "completed",
          }),
        ),
      ).toThrow(/TASK_TRANSITION_FROM_STATUS_MISMATCH/);

      const closed = JSON.parse(
        runCli(root, [
          "task",
          "close",
          "--claim",
          claim.claimId,
          "--actual",
          "1.5",
          "--json",
        ]),
      );
      expect(closed).toMatchObject({
        taskId: "wi-210",
        fromStatus: "ready",
        toStatus: "completed",
        matchedRuleId: "completed-from-ready",
      });
      const workItem = await fs.readFile(
        path.join(root, "backlog/210-close.md"),
        "utf8",
      );
      expect(workItem).toContain("status: completed");
      expect(workItem).toContain("status_reason: completed");
      expect(workItem).toContain("actual: 1.5");
      expect(workItem).toContain("[[record-wi-210-close]]");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("supports the full dogfood flow without hand-editing backlog evidence", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "208-dogfood.md",
        `id: wi-208
title: Dogfood
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );

      const ready = JSON.parse(
        runCli(root, ["task", "ready", "--json"]),
      );
      expect(ready.candidates.map((task: { id: string }) => task.id)).toEqual([
        "wi-208",
      ]);

      const claim = JSON.parse(
        runCli(root, [
          "task",
          "claim",
          "wi-208",
          "--holder",
          "sandcastle",
          "--branch",
          "feature/wi-208",
          "--sandbox",
          root,
          "--json",
        ]),
      );
      expect(claim.state).toBe("active");

      const show = JSON.parse(
        runCli(root, ["task", "show", "wi-208", "--json"]),
      );
      expect(show).toMatchObject({ id: "wi-208", title: "Dogfood" });
      const prompt = runCli(root, ["task", "prompt", "wi-208"]);
      expect(prompt).toContain("Implement wi-208: Dogfood");

      const evidence = JSON.parse(
        runCli(
          root,
          [
            "task",
            "record",
            "--claim",
            claim.claimId,
            "--payload",
            "-",
            "--json",
          ],
          JSON.stringify({
            id: "record:wi-208-dogfood",
            type: "test-result",
            summary: "Dogfood validation",
            observation: "Ready, claim, show, prompt, record, and release passed.",
            outcome: "pass",
          }),
        ),
      );
      expect(evidence).toMatchObject({
        taskId: "wi-208",
        evidenceLink: "[[record-wi-208-dogfood]]",
      });

      const released = JSON.parse(
        runCli(root, ["task", "release", "--claim", claim.claimId, "--json"]),
      );
      expect(released.state).toBe("released");

      const workItem = await fs.readFile(
        path.join(root, "backlog/208-dogfood.md"),
        "utf8",
      );
      expect(workItem).toContain("[[record-wi-208-dogfood]]");
      expect(workItem).toContain("status: ready");
      expect(workItem).not.toContain("status: closed");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});
