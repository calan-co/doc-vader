import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readClaimAuthority } from "../lib/claim/index.js";
import {
  claimTask,
  getActiveClaimForTask,
  getActiveClaimsForTask,
  getClaimStatus,
  getClaimStatusForTask,
  listTaskClaims,
  recoverClaim,
  releaseClaim,
} from "../lib/task/claims.js";
import { loadTaskModel } from "../lib/task/model.js";
import {
  loadCanonicalTask,
  renderSandcastlePrompt,
} from "../lib/task/canonical.js";
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
import { recoverTaskClaim } from "../lib/task/recover.js";
import { createRecoveryTrace } from "../lib/task/recovery-trace.js";
import {
  collectBranchDiffPaths,
  collectTaskRecoveryGitState,
} from "../lib/task/recovery-state.js";
import {
  openRuntimeSqliteStore,
  RUNTIME_SCHEMA_VERSION,
  RuntimeSqliteStore,
} from "../lib/runtime/sqlite-store.js";
import {
  cliClaimedPathGitAuditAdapter,
  esGitClaimedPathGitAuditAdapter,
  type ClaimedPathGitAuditAdapter,
} from "../lib/runtime/git-audit-adapter.js";
import {
  createCliTaskRecoverySafetyStateReader,
  esGitTaskRecoverySafetyStateReader,
} from "../lib/task/recovery-safety-state-reader.js";
import { WORK_COMMAND_ALIASES } from "../lib/work/command-inventory.js";
import { stageWorkGraphUacFixture } from "./helpers/work-graph-uac-fixture";
import { integrationTestTimeoutMs } from "./helper/windows-integration-timeout.js";

const cliPath = path.resolve(__dirname, "../cli/doc-vader.ts");
const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const claimStoreEnv = "DOC_VADER_TASK_CLAIM_STORE";
const RECOVERY_CLI_LATENCY_BUDGET_MS = 4_000;
let previousClaimStoreEnv: string | undefined;

type WorkGraphSummaryPayload = {
  schemaVersion: string;
  command: string;
  summary: {
    nodeCount: number;
    edgeCount: number;
    diagnosticCount: number;
    nodeTypes: Array<{ type: string; count: number }>;
    edgeTypes: Array<{ type: string; count: number }>;
  };
};

type WorkGraphExportPayload = {
  schemaVersion: string;
  command: string;
  summary: {
    nodeCount: number;
    edgeCount: number;
    diagnosticCount: number;
  };
  nodes: Array<{ id: string; type: string }>;
  edges: Array<{ type: string; from: string; to: string }>;
  diagnostics: Array<{ relativePath: string; reasonCode: string }>;
};

beforeEach(() => {
  previousClaimStoreEnv = process.env[claimStoreEnv];
  delete process.env[claimStoreEnv];
});

afterEach(() => {
  if (previousClaimStoreEnv === undefined) {
    delete process.env[claimStoreEnv];
  } else {
    process.env[claimStoreEnv] = previousClaimStoreEnv;
  }
});

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
  await fs.copyFile(
    path.resolve(
      __dirname,
      "../templates/reference/task/sandcastle-prompt.md.tpl",
    ),
    path.join(root, "templates/reference/task/sandcastle-prompt.md.tpl"),
  );
  return root;
}

function initGitRepo(root: string): void {
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

function claimStorePath(root: string): string {
  return path.join(root, ".doc-vader", "runtime", "task-claims");
}

function ensureRuntimeClaimAuthority(root: string): void {
  const store = openRuntimeSqliteStore({ rootDir: root });
  store.close();
}

function acquireRuntimeTaskClaim(
  root: string,
  taskId: string,
  lockPaths: string[],
  holder = "agent-a",
): string {
  const store = openRuntimeSqliteStore({ rootDir: root });
  try {
    const existing = store.getClaimByTarget("task", taskId);
    if (existing) {
      const locks = store.acquireRuntimeLocks(existing.claim_token, lockPaths);
      if (locks.outcome !== "acquired") {
        throw new Error(`Expected runtime lock acquisition for ${taskId}.`);
      }
      return existing.claim_token;
    }
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 60 * 60 * 1000);
    const acquisition = store.acquireRuntimeClaim(
      {
        schema_version: RUNTIME_SCHEMA_VERSION,
        target_type: "task",
        target_id: taskId,
        holder,
        created_at: createdAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        entropy: randomUUID(),
      },
      { initialLockPaths: lockPaths },
    );
    if (acquisition.outcome !== "acquired") {
      throw new Error(`Expected runtime claim acquisition for ${taskId}.`);
    }
    return acquisition.claimToken;
  } finally {
    store.close();
  }
}

function recordRuntimeExecutionLog(
  root: string,
  entry: {
    claim_token: string;
    target_type: string;
    target_id: string;
    state: "running" | "completed" | "failed" | "halted";
    reason:
      | "started"
      | "success"
      | "error"
      | "conflict"
      | "blocked"
      | "invalid"
      | "expired"
      | "revoked"
      | "cancelled";
    created_at: string;
    detail: {
      code: string;
      message?: string;
    };
  },
): void {
  const store = openRuntimeSqliteStore({ rootDir: root });
  try {
    store.insertExecutionLogEntry({
      schema_version: RUNTIME_SCHEMA_VERSION,
      ...entry,
    });
  } finally {
    store.close();
  }
}

async function withClaimStoreEnvCleared<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.DOC_VADER_TASK_CLAIM_STORE;
  delete process.env.DOC_VADER_TASK_CLAIM_STORE;
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.DOC_VADER_TASK_CLAIM_STORE;
    } else {
      process.env.DOC_VADER_TASK_CLAIM_STORE = previous;
    }
  }
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

async function createRecoverableTaskFixture(): Promise<string> {
  const root = await mkTmpRoot();
  initGitRepo(root);
  await fs.writeFile(path.join(root, "README.md"), "base\n", "utf8");
  await fs.writeFile(
    path.join(root, ".gitignore"),
    ".doc-vader/runtime/\n",
    "utf8",
  );
  execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "chore: base"], {
    cwd: root,
    stdio: "ignore",
  });
  execFileSync("git", ["switch", "-c", "sandcastle/issue-300"], {
    cwd: root,
    stdio: "ignore",
  });
  await writeTask(
    root,
    "300-recoverable-task.md",
    `id: wi-300
title: Recoverable Task
type: work-item
lifecycle: active
status: paused
status_reason: blocked
tags:
  - afk`,
  );
  execFileSync("git", ["add", "backlog/300-recoverable-task.md"], {
    cwd: root,
    stdio: "ignore",
  });
  execFileSync("git", ["commit", "-m", "chore: base"], {
    cwd: root,
    stdio: "ignore",
  });
  recordRuntimeExecutionLog(root, {
    claim_token: "claim-wi-300",
    target_type: "task",
    target_id: "wi-300",
    state: "halted",
    reason: "blocked",
    created_at: "2026-06-15T12:00:00.000Z",
    detail: {
      code: "x-runtime-task-blocked",
      message: "Paused for recovery.",
    },
  });
  return root;
}

async function snapshotFiles(rootDir: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      const relativePath = path.relative(rootDir, entryPath);
      snapshot.set(
        relativePath,
        (await fs.readFile(entryPath)).toString("base64"),
      );
    }
  }

  await walk(rootDir);
  return snapshot;
}

function runCli(
  root: string,
  args: string[],
  input?: string,
  env?: NodeJS.ProcessEnv,
  options: { timeout?: number } = {},
): string {
  return execFileSync("node", ["--import", tsxImport, cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    input,
    timeout: options.timeout,
    env: {
      ...process.env,
      DOC_VADER_TASK_CLAIM_STORE: claimStorePath(root),
      ...env,
    },
  });
}

function runCliJson<T>(root: string, args: string[]): T {
  return JSON.parse(runCli(root, args)) as T;
}

type RecoveryLatencyStage =
  | "cliTsxBootstrap"
  | "taskRuntimeLoading"
  | "gitSafetyState"
  | "claimAcquisition"
  | "dryRunTransition"
  | "appliedTransition"
  | "runtimeClaimSqliteAuthorityOpen"
  | "claimLookup"
  | "scopeLockLookup"
  | "gitRevParseAbbrevRefHead"
  | "gitRevParseHead"
  | "requiredPathNormalization"
  | "lockOwnershipDecision";

type RecoveryAuditSubspan = Exclude<
  RecoveryLatencyStage,
  | "cliTsxBootstrap"
  | "taskRuntimeLoading"
  | "gitSafetyState"
  | "claimAcquisition"
  | "dryRunTransition"
  | "appliedTransition"
>;

type RecoveryLatencyStageTiming = {
  durationMs: number;
  invocationCount: number;
};

type RecoveryLatencyProfile = {
  operationOnlyMs: number;
  stages: Record<RecoveryLatencyStage, RecoveryLatencyStageTiming>;
  dominantStage: RecoveryLatencyStage;
  dominantAuditSubspan: RecoveryAuditSubspan;
};

const RECOVERY_LATENCY_STAGES: readonly RecoveryLatencyStage[] = [
  "cliTsxBootstrap",
  "taskRuntimeLoading",
  "gitSafetyState",
  "claimAcquisition",
  "dryRunTransition",
  "appliedTransition",
  "runtimeClaimSqliteAuthorityOpen",
  "claimLookup",
  "scopeLockLookup",
  "gitRevParseAbbrevRefHead",
  "gitRevParseHead",
  "requiredPathNormalization",
  "lockOwnershipDecision",
];

const RECOVERY_AUDIT_SUBSPANS: readonly RecoveryAuditSubspan[] = [
  "runtimeClaimSqliteAuthorityOpen",
  "claimLookup",
  "scopeLockLookup",
  "gitRevParseAbbrevRefHead",
  "gitRevParseHead",
  "requiredPathNormalization",
  "lockOwnershipDecision",
];

function findDominantRecoveryLatencyStage(
  profile: RecoveryLatencyProfile,
): RecoveryLatencyStage {
  return [...RECOVERY_LATENCY_STAGES].sort((left, right) => {
    const durationDifference =
      profile.stages[right].durationMs - profile.stages[left].durationMs;
    return (
      durationDifference ||
      RECOVERY_LATENCY_STAGES.indexOf(left) -
        RECOVERY_LATENCY_STAGES.indexOf(right)
    );
  })[0];
}

function findDominantRecoveryAuditSubspan(
  profile: RecoveryLatencyProfile,
): RecoveryAuditSubspan {
  return [...RECOVERY_AUDIT_SUBSPANS].sort((left, right) => {
    const durationDifference =
      profile.stages[right].durationMs - profile.stages[left].durationMs;
    return (
      durationDifference ||
      RECOVERY_AUDIT_SUBSPANS.indexOf(left) -
        RECOVERY_AUDIT_SUBSPANS.indexOf(right)
    );
  })[0];
}

async function profileTaskRecoveryLatency(
  root: string,
): Promise<RecoveryLatencyProfile> {
  const output = JSON.parse(
    runCli(
      root,
      ["work", "wi-300", "recover", "--json"],
      undefined,
      { DOC_VADER_TEST_RECOVERY_TRACE: "1" },
      { timeout: 15_000 },
    ),
  ) as {
    executionLogEntry: { state: string; reason: string };
    recoveryTrace: RecoveryLatencyProfile;
  };
  expect(output).toMatchObject({
    executionLogEntry: { state: "completed", reason: "success" },
  });
  return output.recoveryTrace;
}

describe.sequential("task command surface", () => {
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
      expect(prompt).toContain("Use `dv work wi-101 show --json`");
      expect(prompt).toContain("Templjs rendering is presentation only");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it(
    "shows and prompts from the canonical Work Item resource route",
    { timeout: 15_000 },
    async () => {
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

        const canonicalTask = await loadCanonicalTask({
          rootDir: root,
          taskId: "101",
        });
        const showOutput = runCli(root, ["work", "101", "show", "--json"]);
        const promptOutput = runCli(root, ["work", "101", "prompt"]);

        expect(JSON.parse(showOutput)).toEqual(canonicalTask);
        expect(promptOutput.trimEnd()).toBe(
          (await renderSandcastlePrompt({ task: canonicalTask })).trimEnd(),
        );
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it("rejects removed task, wi, and verb-first public routes without rewriting them", async () => {
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

      for (const args of [
        ["task", "show", "101", "--json"],
        ["wi", "show", "101", "--json"],
        ["work", "show", "101", "--json"],
      ]) {
        expect(() => runCli(root, args)).toThrow();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it(
    "renders show relationships from graph edges while leaving prompt body content unchanged",
    { timeout: 15_000 },
    async () => {
      const root = await mkTmpRoot();
      try {
        await writeTask(
          root,
          "60396-graph-backed-work-show-relationships.md",
          `id: wi-60396
title: Graph-Backed Work Show Relationships
summary: Verify show uses graph-backed relationship sections.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: high
tags:
  - afk
links:
  depends_on:
    - '[[wi-60395]]'
  part_of:
    - '[[project:graph-backed-show]]'
  implements:
    - '[[../docs/how-to/implementation-plans/show-relationships-prd.md]]'
  evidence:
    - '[[records/record-wi-60396-show-evidence.md]]'`,
          `## Goal

Keep the body content stable.

## Notes

The body section text must still render.

Embedded links such as [[wi-99999]] and [[wi-88888]] are context only.
`,
        );
        await writeTask(
          root,
          "60395-graph-backed-work-list-tracer.md",
          `id: wi-60395
title: Graph-Backed Work List Tracer
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed`,
          `## Goal

Support graph-backed list output.
`,
        );
        await fs.mkdir(
          path.join(root, "docs", "how-to", "implementation-plans"),
          { recursive: true },
        );
        await fs.writeFile(
          path.join(root, "docs", "project-graph-backed-show.md"),
          `---
id: project:graph-backed-show
title: Graph-Backed Show
type: project
subtype: initiative
lifecycle: active
status: ready
---

## Goal

Group graph-backed show work.
`,
          "utf8",
        );
        await fs.writeFile(
          path.join(
            root,
            "docs",
            "how-to",
            "implementation-plans",
            "show-relationships-prd.md",
          ),
          `---
id: plan:show-relationships-prd
title: Show Relationships PRD
type: plan
subtype: x-prd
lifecycle: active
status: ready
---

## Goal

Define graph-backed relationship rendering.
`,
          "utf8",
        );
        await fs.mkdir(path.join(root, "backlog", "records"), {
          recursive: true,
        });
        await fs.writeFile(
          path.join(
            root,
            "backlog",
            "records",
            "record-wi-60396-show-evidence.md",
          ),
          `---
id: record:wi-60396-show-evidence
title: Show Relationship Evidence
type: record
subtype: evidence
lifecycle: active
status: ready
---

## Summary

Show output evidence.
`,
          "utf8",
        );

        const claimToken = acquireRuntimeTaskClaim(root, "wi-60396", []);
        const showText = runCli(root, ["work", "60396", "show"]);
        const showJson = runCliJson<{
          dependencies: Array<{ type: string; target: string }>;
          relationships?: Array<{ type: string; target: string }>;
          records?: Array<{ type: string; target: string }>;
          activeLocks?: Array<{
            claimToken: string;
            scopeRef: string;
            lockMode: string;
          }>;
        }>(root, ["work", "60396", "show", "--json"]);
        const prompt = runCli(root, ["work", "60396", "prompt"]);

        expect(showText).toContain("Keep the body content stable.");
        expect(showText).toContain("The body section text must still render.");
        expect(showText).toContain("## Dependencies");
        expect(showText).toContain("- `depends_on`: [[wi-60395]]");
        expect(showText).toContain("## Relationships");
        expect(showText).toContain(
          "- `belongs_to`: [[project:graph-backed-show]]",
        );
        expect(showText).toContain(
          "- `implements`: [[../docs/how-to/implementation-plans/show-relationships-prd.md]]",
        );
        expect(showText).toContain("## Records");
        expect(showText).toContain(
          "- `records`: [[records/record-wi-60396-show-evidence.md]]",
        );
        expect(showText).toContain("## Active Locks");
        expect(showText).toContain(claimToken);
        expect(showText).toContain("mode=`execute`");
        expect(showText).not.toContain("`blocks`");
        expect(showText).not.toContain("`relates_to`");

        expect(showJson.dependencies).toEqual([
          {
            type: "depends_on",
            target: "[[wi-60395]]",
          },
        ]);
        expect(showJson.relationships).toEqual([
          {
            type: "belongs_to",
            target: "[[project:graph-backed-show]]",
          },
          {
            type: "implements",
            target:
              "[[../docs/how-to/implementation-plans/show-relationships-prd.md]]",
          },
        ]);
        expect(showJson.records).toEqual([
          {
            type: "records",
            target: "[[records/record-wi-60396-show-evidence.md]]",
          },
        ]);
        expect(showJson.activeLocks).toEqual([
          {
            claimToken,
            scopeRef: "wi:60396",
            lockMode: "execute",
          },
        ]);

        expect(prompt).toContain("Keep the body content stable.");
        expect(prompt).toContain("The body section text must still render.");
        expect(prompt).toContain("## Dependencies");
        expect(prompt).toContain("- `depends_on`: [[wi-60395]]");
        expect(prompt).toContain("## Relationships");
        expect(prompt).toContain(
          "- `belongs_to`: [[project:graph-backed-show]]",
        );
        expect(prompt).toContain(
          "- `implements`: [[../docs/how-to/implementation-plans/show-relationships-prd.md]]",
        );
        expect(prompt).not.toContain("### Relationships");
        expect(prompt).not.toContain("`blocks`");
        expect(prompt).not.toContain("`relates_to`");
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "lists only backlog work items through the work command surface",
    { timeout: 15_000 },
    async () => {
      const root = await mkTmpRoot();
      try {
        await fs.mkdir(path.join(root, "docs"), { recursive: true });
        await writeTask(
          root,
          "100-backlog-item.md",
          `id: wi-100
title: Backlog Item
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
        );
        await fs.writeFile(
          path.join(root, "docs", "999-shadow-work-item.md"),
          `---
id: wi-999
title: Shadow Work Item
type: work-item
lifecycle: active
status: ready
---
`,
          "utf8",
        );
        await fs.writeFile(
          path.join(root, "backlog", "AGENTS.md"),
          `---
id: backloga-2056
title: Backlog Agents Policy
type: document
subtype: generic
lifecycle: evergreen
status: closed
---
`,
          "utf8",
        );

        const listJson = runCliJson<{
          schemaVersion: string;
          tasks: Array<{ id: string; title: string; filePath: string }>;
        }>(root, ["work", "list", "--json"]);

        expect(listJson).toEqual({
          schemaVersion: "task-list/v1",
          tasks: [
            {
              id: "wi-100",
              status: "ready",
              title: "Backlog Item",
              filePath: "backlog/100-backlog-item.md",
              lifecycle: "active",
              runtime: expect.objectContaining({
                markdownReady: true,
                sourceDisagreement: false,
              }),
            },
          ],
        });

        const listText = runCli(root, ["work", "list"]);
        expect(listText).toContain("wi-100 | ready | Backlog Item");
        expect(listText).not.toContain("wi-999");
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it("updates work item status through the work command surface", async () => {
    const root = await mkTmpRoot();
    try {
      ensureRuntimeClaimAuthority(root);
      await writeTask(
        root,
        "301-update-surface.md",
        `id: wi-301
title: Update Surface
type: work-item
lifecycle: active
status: ready
links:
  evidence:
    - '[[record-update-surface]]'
tags:
  - afk`,
        `## Tasks

- [x] Prepare terminal metadata

## Acceptance Criteria

- [x] Validate terminal metadata
`,
      );

      const result = runCliJson<{
        id: string;
        filePath: string;
        frontmatter: {
          status: string;
          status_reason: string;
          lifecycle: string;
          completed_date?: string;
        };
        dryRun: boolean;
      }>(root, [
        "work",
        "301",
        "update",
        "--input",
        JSON.stringify({ status: "completed", statusReason: "completed", actual: 1 }),
        "--json",
      ]);

      expect(result).toMatchObject({
        id: "wi-301",
        filePath: expect.stringContaining("301-update-surface.md"),
        frontmatter: {
          status: "completed",
          status_reason: "completed",
          lifecycle: "active",
        },
        dryRun: false,
      });
      expect(result.frontmatter.completed_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const status = runCliJson<{ status: string; statusReason?: string }>(
        root,
        ["work", "301", "status", "--json"],
      );
      expect(status).toMatchObject({
        status: "completed",
        statusReason: "completed",
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects caller-supplied completion dates on work updates", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "301-reject-completed-date.md",
        `id: wi-301-reject-completed-date
title: Reject Completion Date
type: work-item
lifecycle: active
status: ready
status_reason: auto
actual: 1
links:
  evidence:
    - '[[record-completion-evidence]]'
tags:
  - afk`,
        `## Tasks

- [x] Implement the change

## Acceptance Criteria

- [x] Validate the change
`,
      );

      expect(() =>
        runCli(root, [
          "work",
          "wi-301-reject-completed-date",
          "update",
          "--input",
          JSON.stringify({ status: "completed", statusReason: "completed", completedDate: "2000-01-01" }),
          "--json",
        ]),
      ).toThrow(/completedDate/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("terminally completes and releases the active claim through work update", async () => {
    const root = await mkTmpRoot();
    try {
      ensureRuntimeClaimAuthority(root);
      await writeTask(
        root,
        "301-terminal-close.md",
        `id: wi-301-terminal-close
title: Terminal Close
type: work-item
lifecycle: active
status: ready
status_reason: auto
actual: 1
links:
  evidence:
    - '[[record-terminal-close]]'
tags:
  - afk`,
        `## Tasks

- [x] Implement the close flow

## Acceptance Criteria

- [x] Validate terminal completion
`,
      );
      const taskPath = path.join(root, "backlog", "301-terminal-close.md");
      const claimToken = acquireRuntimeTaskClaim(
        root,
        "wi-301-terminal-close",
        [taskPath],
      );

      const result = runCliJson<{
        frontmatter: {
          status: string;
          status_reason: string;
          completed_date: string;
        };
      }>(root, [
        "work",
        "wi-301-terminal-close",
        "update",
        "--input",
        JSON.stringify({ status: "completed", statusReason: "completed", actual: 1 }),
        "--claim",
        claimToken,
        "--json",
      ]);

      expect(result.frontmatter).toMatchObject({
        status: "completed",
        status_reason: "completed",
      });
      expect(result.frontmatter.completed_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const store = openRuntimeSqliteStore({ rootDir: root });
      try {
        expect(store.getClaimByToken(claimToken)).toBeUndefined();
        expect(store.listLocksByClaimToken(claimToken)).toEqual([]);
        expect(store.listExecutionLogEntries()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              claim_token: claimToken,
              state: "completed",
              reason: "success",
            }),
          ]),
        );
      } finally {
        store.close();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("requires the exact active claim and its work-item lock before work updates", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "302-claim-authorized-update.md",
        `id: wi-302
title: Claim Authorized Update
type: work-item
lifecycle: active
status: ready
status_reason: auto
tags:
  - afk`,
      );
      const taskPath = path.join(
        root,
        "backlog",
        "302-claim-authorized-update.md",
      );
      const claimToken = acquireRuntimeTaskClaim(root, "wi-302", [taskPath]);
      const before = await fs.readFile(taskPath, "utf8");

      expect(() =>
        runCli(root, [
          "work", "302", "update", "--input",
          JSON.stringify({ status: "ready", assignee: "agent-a" }), "--json",
        ]),
      ).toThrow(/WORK_MUTATION_CLAIM_REQUIRED/);
      await expect(fs.readFile(taskPath, "utf8")).resolves.toBe(before);
      expect(() =>
        runCli(root, [
          "work", "302", "update", "--input",
          JSON.stringify({ status: "ready", assignee: "agent-a" }),
          "--claim", "not-the-active-claim", "--json",
        ]),
      ).toThrow(/WORK_MUTATION_CLAIM_REQUIRED/);
      await expect(fs.readFile(taskPath, "utf8")).resolves.toBe(before);

      const result = runCliJson<{ frontmatter: { assignee: string } }>(root, [
        "work", "302", "update", "--input",
        JSON.stringify({ status: "ready", assignee: "agent-a" }),
        "--claim", claimToken, "--json",
      ]);
      expect(result.frontmatter.assignee).toBe("agent-a");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("acquires work claims with the work item, committed branch diff, and governed dirty paths locked", async () => {
    const root = await mkTmpRoot();
    try {
      initGitRepo(root);
      await writeTask(
        root,
        "302-work-claim-coverage.md",
        `id: wi-302-work-claim-coverage
title: Work Claim Coverage
type: work-item
lifecycle: active
status: ready
status_reason: auto
tags:
  - afk`,
      );
      execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "chore: base"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync("git", ["switch", "-c", "work-claim-coverage"], {
        cwd: root,
        stdio: "ignore",
      });
      await fs.mkdir(path.join(root, "lib"), { recursive: true });
      await fs.writeFile(
        path.join(root, "lib", "committed-change.ts"),
        "export {};\n",
      );
      execFileSync("git", ["add", "lib/committed-change.ts"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync("git", ["commit", "-m", "feat: committed change"], {
        cwd: root,
        stdio: "ignore",
      });
      await fs.writeFile(
        path.join(root, "backlog", "uncommitted-change.md"),
        "# dirty\n",
      );
      ensureRuntimeClaimAuthority(root);

      const claimed = runCliJson<{ claimToken: string }>(root, [
        "work", "wi-302-work-claim-coverage", "claim", "--json",
      ]);
      const store = openRuntimeSqliteStore({ rootDir: root });
      try {
        expect(
          store
            .listLocksByClaimToken(claimed.claimToken)
            .map((lock) => lock.path)
            .sort(),
        ).toEqual([
          "backlog/302-work-claim-coverage.md",
          "backlog/uncommitted-change.md",
          "lib/committed-change.ts",
        ]);
      } finally {
        store.close();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });


  it("fails closed before mutation when automation closed updates lack terminal metadata", async () => {
    const root = await mkTmpRoot();
    try {
      ensureRuntimeClaimAuthority(root);
      await writeTask(
        root,
        "302-missing-close-metadata.md",
        `id: wi-302
title: Missing Close Metadata
type: work-item
lifecycle: active
status: ready
status_reason: auto
tags:
  - afk`,
        `## Tasks

- [x] Prepare close

## Acceptance Criteria

- [x] Validate close metadata
`,
      );
      const before = await fs.readFile(
        path.join(root, "backlog/302-missing-close-metadata.md"),
        "utf8",
      );

      let error: unknown;
      try {
        runCli(root, ["work", "302", "update", "--input", JSON.stringify({ status: "closed" }), "--json"]);
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeDefined();
      const processError = error as { stderr?: Buffer | string };
      const stderr = String(processError.stderr ?? "{}");
      expect(stderr).toContain("WORK_UPDATE_CLOSED_METADATA_REQUIRED");
      expect(stderr).toContain('"actual"');
      expect(stderr).toContain('"links.evidence"');
      expect(stderr).toContain("--actual");
      await expect(
        fs.readFile(
          path.join(root, "backlog/302-missing-close-metadata.md"),
          "utf8",
        ),
      ).resolves.toBe(before);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("treats automation closed updates as canonical completed work", async () => {
    const root = await mkTmpRoot();
    try {
      ensureRuntimeClaimAuthority(root);
      await writeTask(
        root,
        "302-closed-alias.md",
        `id: wi-302
title: Closed Alias
type: work-item
lifecycle: active
status: ready
status_reason: auto
actual: 0
links:
  evidence:
    - '[[backlog/audit/auditing-backlog-report.json]]'
tags:
  - afk`,
        `## Tasks

- [x] Execute close automation

## Acceptance Criteria

- [x] Canonicalize closed status
`,
      );

      const result = runCliJson<{
        id: string;
        frontmatter: {
          status: string;
          status_reason: string;
          lifecycle: string;
          actual?: number;
          completed_date?: string;
        };
        dryRun: boolean;
      }>(root, ["work", "302", "update", "--input", JSON.stringify({ status: "closed" }), "--json"]);

      expect(result).toMatchObject({
        id: "wi-302",
        frontmatter: {
          status: "completed",
          status_reason: "completed",
          lifecycle: "active",
          actual: 0,
        },
        dryRun: false,
      });
      expect(result.frontmatter.completed_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const status = runCliJson<{ status: string; statusReason?: string }>(
        root,
        ["work", "302", "status", "--json"],
      );
      expect(status).toMatchObject({
        status: "completed",
        statusReason: "completed",
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it.skip(
    "explores the projected work graph through read-only work and wi CLI commands",
    { timeout: 30_000 },
    async () => {
      const root = await mkTmpRoot();
      try {
        await writeTask(
          root,
          "60393-read-only-work-graph-explorer-cli.md",
          `id: wi-60393
title: Read-Only Work Graph Explorer CLI
summary: Add a read-only graph explorer.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: high
tags:
  - afk
links:
  depends_on:
    - '[[60392-live-repository-graph-projection-robustness]]'
  implements:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]'`,
          `## Goal

Inspect the projected work graph.
`,
        );
        await writeTask(
          root,
          "60392-live-repository-graph-projection-robustness.md",
          `id: wi-60392
title: Live Repository Graph Projection Robustness
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed`,
          `## Goal

Keep live projection robust.
`,
        );
        await fs.mkdir(
          path.join(root, "docs", "how-to", "implementation-plans"),
          { recursive: true },
        );
        await fs.writeFile(
          path.join(
            root,
            "docs",
            "how-to",
            "implementation-plans",
            "doc-vader-work-item-claim-scope-mvp-prd.md",
          ),
          `---
id: plan:doc-vader-work-item-claim-scope-mvp-prd
title: Doc-Vader Work Item Claim Scope MVP PRD
type: plan
subtype: x-prd
lifecycle: active
status: ready
---

## Goal

Define the Work graph MVP.
`,
          "utf8",
        );
        await fs.writeFile(
          path.join(root, "backlog", "AGENTS.md"),
          `---
id: backloga-2056
title: Backlog Agents Policy
type: document
subtype: generic
lifecycle: evergreen
status: closed
---

Helper policy document that should stay diagnostic-only.
`,
          "utf8",
        );

        await expect(
          fs.stat(path.join(root, ".doc-vader", "runtime")),
        ).rejects.toMatchObject({ code: "ENOENT" });

        const nodes = runCliJson<{
          schemaVersion: string;
          command: string;
          nodes: Array<{ id: string; type: string }>;
          diagnostics: Array<{ relativePath: string; reasonCode: string }>;
        }>(root, ["work", "graph", "nodes"]);
        expect(nodes.schemaVersion).toBe("work-graph-explorer/v1");
        expect(nodes.command).toBe("nodes");
        expect(nodes.nodes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: "wi:60393", type: "work-item" }),
            expect.objectContaining({
              id: "scope:plan:doc-vader-work-item-claim-scope-mvp-prd",
              type: "scope",
            }),
          ]),
        );
        expect(nodes.diagnostics).toEqual([
          expect.objectContaining({
            relativePath: "backlog/AGENTS.md",
            reasonCode: "unsupported-document-type",
          }),
        ]);

        const workItemNodes = runCliJson<{
          nodes: Array<{ id: string; type: string }>;
        }>(root, [
          "work",
          "graph",
          "nodes",
          "--format",
          "json",
          "--node-type",
          "work-item",
        ]);
        expect(workItemNodes.nodes.map((node) => node.type)).toEqual([
          "work-item",
          "work-item",
        ]);

        const edges = runCliJson<{
          command: string;
          edges: Array<{ type: string; from: string; to: string }>;
          diagnostics: Array<{ relativePath: string }>;
        }>(root, [
          "wi",
          "graph",
          "edges",
          "--format",
          "json",
          "--edge-type",
          "depends_on",
          "--source",
          "wi:60393",
        ]);
        expect(edges.command).toBe("edges");
        expect(edges.edges).toEqual([
          expect.objectContaining({
            type: "depends_on",
            from: "wi:60393",
            to: "wi:60392",
          }),
        ]);
        expect(edges.diagnostics).toHaveLength(1);

        const targetEdges = runCliJson<{
          edges: Array<{ type: string; from: string; to: string }>;
        }>(root, [
          "wi",
          "graph",
          "edges",
          "--format",
          "json",
          "--target",
          "wi:60392",
        ]);
        expect(targetEdges.edges).toEqual([
          expect.objectContaining({
            type: "depends_on",
            from: "wi:60393",
            to: "wi:60392",
          }),
        ]);

        const neighborhoodEdges = runCliJson<{
          edges: Array<{ type: string; from: string; to: string }>;
        }>(root, [
          "work",
          "graph",
          "edges",
          "--format",
          "json",
          "--node",
          "scope:plan:doc-vader-work-item-claim-scope-mvp-prd",
        ]);
        expect(neighborhoodEdges.edges).toEqual([
          expect.objectContaining({
            type: "implements",
            from: "wi:60393",
            to: "scope:plan:doc-vader-work-item-claim-scope-mvp-prd",
          }),
        ]);

        const inspect = runCliJson<{
          command: string;
          node: { id: string; type: string };
          neighborhood: {
            nodes: Array<{ id: string }>;
            outgoingEdges: Array<{ type: string; to: string }>;
            incomingEdges: Array<{ type: string }>;
          };
        }>(root, ["wi", "graph", "inspect", "wi:60393", "--format", "json"]);
        expect(inspect.command).toBe("inspect");
        expect(inspect.node).toMatchObject({
          id: "wi:60393",
          type: "work-item",
        });
        expect(inspect.neighborhood.nodes.map((node) => node.id)).toEqual(
          expect.arrayContaining([
            "wi:60392",
            "scope:plan:doc-vader-work-item-claim-scope-mvp-prd",
          ]),
        );
        expect(inspect.neighborhood.outgoingEdges).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "depends_on",
              to: "wi:60392",
            }),
            expect.objectContaining({
              type: "implements",
              to: "scope:plan:doc-vader-work-item-claim-scope-mvp-prd",
            }),
          ]),
        );
        expect(inspect.neighborhood.incomingEdges).toEqual([]);

        const summaryText = runCli(root, ["work", "graph", "summary"]);
        expect(summaryText).toContain("Work Graph Summary");
        expect(summaryText).toContain("Nodes\t3 scope, 2 work-item");
        expect(summaryText).toContain("Edges\t1 depends_on, 1 implements");
        expect(summaryText).toContain("Diagnostics\t1");

        const summaryJson = runCliJson<WorkGraphSummaryPayload>(root, [
          "wi",
          "graph",
          "summary",
          "--format",
          "json",
        ]);
        expect(summaryJson.schemaVersion).toBe("work-graph-explorer/v1");
        expect(summaryJson.command).toBe("summary");
        expect(summaryJson.summary).toEqual({
          nodeCount: 5,
          edgeCount: 2,
          diagnosticCount: 1,
          nodeTypes: [
            { type: "scope", count: 3 },
            { type: "work-item", count: 2 },
          ],
          edgeTypes: [
            { type: "depends_on", count: 1 },
            { type: "implements", count: 1 },
          ],
        });

        const exported = runCliJson<WorkGraphExportPayload>(root, [
          "work",
          "graph",
          "export",
        ]);
        expect(exported.schemaVersion).toBe("work-graph-explorer/v1");
        expect(exported.command).toBe("export");
        expect(exported.summary).toMatchObject({
          nodeCount: 5,
          edgeCount: 2,
          diagnosticCount: 1,
        });
        expect(exported.nodes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: "scope:wi:60392" }),
            expect.objectContaining({ id: "scope:wi:60393" }),
            expect.objectContaining({
              id: "scope:plan:doc-vader-work-item-claim-scope-mvp-prd",
            }),
            expect.objectContaining({ id: "wi:60392" }),
            expect.objectContaining({ id: "wi:60393" }),
          ]),
        );
        expect(exported.edges).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "depends_on",
              from: "wi:60393",
              to: "wi:60392",
            }),
            expect.objectContaining({
              type: "implements",
              from: "wi:60393",
              to: "scope:plan:doc-vader-work-item-claim-scope-mvp-prd",
            }),
          ]),
        );
        expect(exported.diagnostics).toEqual([
          expect.objectContaining({
            relativePath: "backlog/AGENTS.md",
            reasonCode: "unsupported-document-type",
          }),
        ]);
        expect(
          exported.nodes.some((node) => node.id === "backlog/AGENTS.md"),
        ).toBe(false);

        const exportDot = runCli(root, [
          "work",
          "graph",
          "export",
          "--format",
          "dot",
        ]);
        expect(exportDot).toContain("digraph WorkGraph {");
        expect(exportDot).toContain(
          '"wi:60393" -> "wi:60392" [label="depends_on"]',
        );
        expect(exportDot).toContain(
          '"wi:60393" -> "scope:plan:doc-vader-work-item-claim-scope-mvp-prd" [label="implements"]',
        );

        const dot = runCli(root, [
          "work",
          "graph",
          "inspect",
          "wi:60393",
          "--format",
          "dot",
        ]);
        expect(dot).toContain("digraph WorkGraph {");
        expect(dot).toContain('"wi:60393" -> "wi:60392" [label="depends_on"]');
        expect(dot).toContain(
          '"wi:60393" -> "scope:plan:doc-vader-work-item-claim-scope-mvp-prd" [label="implements"]',
        );

        expect(() =>
          runCli(root, ["work", "graph", "nodes", "--format", "digraph"]),
        ).toThrow();
        await expect(
          fs.stat(path.join(root, ".doc-vader", "runtime")),
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    15000,
  );

  it.skip("allows filtering references edges from the work graph CLI", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "300-reference-source.md",
        `id: wi-300
title: Reference Source
type: work-item
subtype: task
lifecycle: active
status: ready
priority: medium
links:
  reference:
    - '[[301-reference-target]]'`,
      );
      await writeTask(
        root,
        "301-reference-target.md",
        `id: wi-301
title: Reference Target
type: work-item
subtype: task
lifecycle: active
status: ready
priority: medium`,
      );

      const references = runCliJson<{
        edges: Array<{ type: string; from: string; to: string }>;
      }>(root, [
        "work",
        "graph",
        "edges",
        "--format",
        "json",
        "--edge-type",
        "references",
      ]);

      expect(references.edges).toEqual([
        expect.objectContaining({
          type: "references",
          from: "wi:300",
          to: "wi:301",
        }),
      ]);
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

      await expect(
        loadTaskModel("missing", { rootDir: root }),
      ).rejects.toMatchObject({
        code: "TASK_NOT_FOUND",
      });
      await expect(
        loadTaskModel("102", { rootDir: root }),
      ).rejects.toMatchObject({
        code: "TASK_AMBIGUOUS",
      });
      await expect(
        loadTaskModel("wi-102", { rootDir: root }),
      ).rejects.toMatchObject({
        code: "TASK_ARCHIVED",
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("maps task claim status and release from runtime Claim-pack records, not local JSON", async () => {
    const root = await mkTmpRoot();
    try {
      const now = new Date();
      const claimId = acquireRuntimeTaskClaim(root, "wi-103", [], "agent-a");
      await fs.writeFile(
        claimStorePath(root),
        JSON.stringify({
          claims: [
            {
              id: claimId,
              taskId: "forged",
              holder: "forged",
              createdAt: now.toISOString(),
              updatedAt: now.toISOString(),
              expiresAt: "2000-01-01T00:00:00.000Z",
            },
          ],
        }),
      );
      await expect(
        getClaimStatus(claimId, {
          rootDir: root,
          claimStorePath: claimStorePath(root),
          now,
        }),
      ).resolves.toMatchObject({ state: "active", taskId: "wi-103" });
      await expect(
        getActiveClaimForTask("wi-103", {
          rootDir: root,
          claimStorePath: claimStorePath(root),
          now,
        }),
      ).resolves.toMatchObject({ id: claimId, taskId: "wi-103" });
      await expect(
        getActiveClaimsForTask("wi-103", {
          rootDir: root,
          claimStorePath: claimStorePath(root),
          now,
        }),
      ).resolves.toMatchObject([{ id: claimId, taskId: "wi-103" }]);
      await expect(
        getClaimStatusForTask("wi-103", {
          rootDir: root,
          claimStorePath: claimStorePath(root),
          now,
        }),
      ).resolves.toMatchObject({ claimId, state: "active", taskId: "wi-103" });
      await expect(
        listTaskClaims({
          rootDir: root,
          claimStorePath: claimStorePath(root),
          now,
        }),
      ).resolves.toMatchObject([
        { claimId, state: "active", taskId: "wi-103" },
      ]);
      await expect(
        releaseClaim(claimId, {
          rootDir: root,
          claimStorePath: claimStorePath(root),
          now,
        }),
      ).resolves.toMatchObject({ state: "released", taskId: "wi-103" });
      await expect(
        getClaimStatus(claimId, {
          rootDir: root,
          claimStorePath: claimStorePath(root),
          now,
        }),
      ).resolves.toMatchObject({ state: "missing" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("halts runtime claims through the CLI and preserves terminal log state", async () => {
    const root = await mkTmpRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const acquisition = store.acquireRuntimeClaim({
        schema_version: RUNTIME_SCHEMA_VERSION,
        target_type: "task",
        target_id: "wi-107",
        holder: "agent-a",
        created_at: "2026-06-15T12:00:00.000Z",
        expires_at: "2026-06-15T13:00:00.000Z",
        entropy: "entropy-halting",
      });
      if (acquisition.outcome !== "acquired") {
        throw new Error("Expected the claim to be acquired.");
      }

      store.close();

      const output = JSON.parse(
        runCli(root, [
          "claim",
          "release",
          acquisition.claimToken,
          "--outcome",
          "blocked",
          "--code",
          "x-runtime-claim-halted",
          "--json",
        ]),
      );

      expect(output).toMatchObject({
        claimToken: acquisition.claimToken,
        executionLogEntry: {
          claim_token: acquisition.claimToken,
          state: "halted",
          reason: "blocked",
        },
      });
      const reopened = openRuntimeSqliteStore({ rootDir: root });
      try {
        expect(reopened.listClaims()).toHaveLength(0);
        expect(reopened.listLocks()).toHaveLength(0);
        expect(reopened.listExecutionLogEntries()).toHaveLength(2);
        expect(reopened.listExecutionLogEntries()[1]).toMatchObject({
          claim_token: acquisition.claimToken,
          state: "halted",
          reason: "blocked",
        });
      } finally {
        reopened.close();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("records changed-file audit details when halting a dirty execution", async () => {
    const root = await mkTmpRoot();
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
    await fs.writeFile(path.join(root, "README.md"), "base\n", "utf8");
    execFileSync("git", ["add", "README.md"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "chore: base"], {
      cwd: root,
      stdio: "ignore",
    });
    const store = openRuntimeSqliteStore({ rootDir: root });
    let storeClosed = false;
    try {
      const acquisition = store.acquireRuntimeClaim({
        schema_version: RUNTIME_SCHEMA_VERSION,
        target_type: "task",
        target_id: "wi-107-audit",
        holder: "agent-a",
        created_at: "2026-06-15T12:00:00.000Z",
        expires_at: "2026-06-15T13:00:00.000Z",
        entropy: "entropy-halting-audit",
      });
      if (acquisition.outcome !== "acquired") {
        throw new Error("Expected the claim to be acquired.");
      }

      store.close();
      storeClosed = true;
      await fs.appendFile(path.join(root, "README.md"), "dirty\n");

      const output = JSON.parse(
        runCli(root, [
          "claim",
          "release",
          acquisition.claimToken,
          "--outcome",
          "blocked",
          "--code",
          "x-runtime-claim-halted",
          "--json",
        ]),
      ) as {
        executionLogEntry: {
          payload: string;
        };
      };
      const payload = JSON.parse(output.executionLogEntry.payload) as {
        detail: {
          code: string;
          "x-dirty-paths"?: string[];
          "x-unlocked-paths"?: string[];
          "x-changed-file-audit"?: {
            claimToken: string;
            passed: boolean;
            diagnostics: Array<{
              path: string;
              actualLockState: string;
            }>;
          };
        };
      };

      expect(payload.detail).toMatchObject({
        code: "x-runtime-claim-halted",
        "x-dirty-paths": expect.arrayContaining(["README.md"]),
        "x-unlocked-paths": expect.arrayContaining(["README.md"]),
      });
      expect(payload.detail["x-changed-file-audit"]).toMatchObject({
        claimToken: acquisition.claimToken,
        passed: false,
      });
      expect(payload.detail["x-changed-file-audit"]?.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "README.md",
            actualLockState: "missing",
          }),
        ]),
      );
    } finally {
      if (!storeClosed) {
        store.close();
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("halts lock-conflict claims through the CLI and transitions the work item", async () => {
    const root = await mkTmpRoot();
    await writeTask(
      root,
      "108-conflict-task.md",
      `id: wi-108
title: Conflict Task
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
    );
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const acquisition = store.acquireRuntimeClaim({
        schema_version: RUNTIME_SCHEMA_VERSION,
        target_type: "task",
        target_id: "wi-108",
        holder: "agent-a",
        created_at: "2026-06-15T12:00:00.000Z",
        expires_at: "2026-06-15T13:00:00.000Z",
        entropy: "entropy-lock-conflict",
      });
      if (acquisition.outcome !== "acquired") {
        throw new Error("Expected the claim to be acquired.");
      }

      store.close();

      const output = JSON.parse(
        runCli(root, [
          "claim",
          "release",
          acquisition.claimToken,
          "--outcome",
          "conflict",
          "--code",
          "lock",
          "--json",
        ]),
      );

      expect(output).toMatchObject({
        claimToken: acquisition.claimToken,
        executionLogEntry: {
          claim_token: acquisition.claimToken,
          state: "halted",
          reason: "conflict",
        },
      });

      const reopened = openRuntimeSqliteStore({ rootDir: root });
      try {
        expect(reopened.listClaims()).toHaveLength(0);
        expect(reopened.listLocks()).toHaveLength(0);
      } finally {
        reopened.close();
      }

      const transitioned = await loadTaskModel("wi-108", { rootDir: root });
      expect(transitioned.status).toBe("paused");
      expect(transitioned.statusReason).toBe("system");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("does not use a shared claim-store path as task status authority", async () => {
    const root = await mkTmpRoot();
    const otherRoot = await mkTmpRoot();
    const sharedClaimStore = path.join(root, "shared", "task-claims");
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
      ).resolves.toMatchObject({ state: "active", taskId: "wi-104" });
      await expect(
        getClaimStatus(claim.claimId, {
          rootDir: otherRoot,
          claimStorePath: sharedClaimStore,
        }),
      ).resolves.toMatchObject({ state: "missing" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(otherRoot, { recursive: true, force: true });
    }
  });

  it("does not use configured claim store path as task status authority", async () => {
    const root = await mkTmpRoot();
    const otherRoot = await mkTmpRoot();
    const sharedClaimStore = path.join(
      root,
      "shared",
      `claims-${randomUUID()}`,
    );
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
            task: { claimStorePath: sharedClaimStore },
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
            task: { claimStorePath: sharedClaimStore },
          },
          null,
          2,
        ),
        "utf8",
      );

      await withClaimStoreEnvCleared(async () => {
        const claim = await claimTask("wi-106", {
          rootDir: root,
          holder: "agent-a",
        });

        await expect(
          claimTask("wi-106", {
            rootDir: otherRoot,
            holder: "agent-b",
          }),
        ).resolves.toMatchObject({ state: "active", taskId: "wi-106" });
        await expect(
          getClaimStatus(claim.claimId, { rootDir: otherRoot }),
        ).resolves.toMatchObject({ state: "missing" });
      });
    } finally {
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
      ).resolves.toMatchObject({ state: "expired" });
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

  it(
    "classifies and recovers expired branch-aware claims",
    { timeout: 15_000 },
    async () => {
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
        execFileSync("git", ["add", "."], { cwd: root });
        execFileSync("git", ["commit", "-m", "chore: base"], {
          cwd: root,
          stdio: "ignore",
        });
        execFileSync("git", ["switch", "-c", "sandcastle/issue-107"], {
          cwd: root,
          stdio: "ignore",
        });
        await fs.writeFile(
          path.join(root, "README.md"),
          "base\nwork\n",
          "utf8",
        );
        await fs.writeFile(
          path.join(root, ".gitignore"),
          ".doc-vader/runtime/\n",
          "utf8",
        );
        execFileSync("git", ["add", "."], { cwd: root });
        execFileSync("git", ["commit", "-m", "feat: work"], {
          cwd: root,
          stdio: "ignore",
        });

        const claim = await claimTask("wi-107", {
          rootDir: root,
          claimStorePath: claimStorePath(root),
          holder: "agent-a",
          branch: "sandcastle/issue-107",
          baseRef: "main",
          worktreePath: root,
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
          getClaimStatus(claim.claimId, { rootDir: root }),
        ).resolves.toMatchObject({ claimId: claim.claimId, state: "active" });
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "fails recovery adoption when changed-file lock coverage is missing",
    { timeout: 15_000 },
    async () => {
      const root = await mkTmpRoot();
      try {
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
        await fs.writeFile(path.join(root, "README.md"), "base\n", "utf8");
        await fs.writeFile(
          path.join(root, ".gitignore"),
          ".doc-vader/runtime/\n",
          "utf8",
        );
        execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
        execFileSync("git", ["commit", "-m", "chore: base"], {
          cwd: root,
          stdio: "ignore",
        });
        execFileSync("git", ["switch", "-c", "sandcastle/issue-211"], {
          cwd: root,
          stdio: "ignore",
        });
        await fs.writeFile(
          path.join(root, "README.md"),
          "base\nwork\n",
          "utf8",
        );
        execFileSync("git", ["add", "README.md"], {
          cwd: root,
          stdio: "ignore",
        });
        execFileSync("git", ["commit", "-m", "feat: work"], {
          cwd: root,
          stdio: "ignore",
        });

        const claim = await claimTask("wi-211", {
          rootDir: root,
          claimStorePath: claimStorePath(root),
          holder: "agent-a",
          branch: "sandcastle/issue-211",
          baseRef: "main",
          worktreePath: root,
          ttlMinutes: 1,
          now: new Date("2026-06-15T12:00:00.000Z"),
        });
        const later = new Date("2026-06-15T12:02:00.000Z");

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
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it("fails closed before mutation when the CLI recovery safety reader cannot read status", async () => {
    const root = await createRecoverableTaskFixture();
    const gitExecutable = path.join(root, "git-status-failure");
    const systemGit = execFileSync("which", ["git"], {
      encoding: "utf8",
    }).trim();
    await fs.writeFile(
      gitExecutable,
      `#!/bin/sh
if [ "$1" = "status" ]; then
  echo "status unavailable" >&2
  exit 2
fi
exec "${systemGit}" "$@"
`,
      { encoding: "utf8", mode: 0o755 },
    );
    try {
      await expect(
        recoverTaskClaim({
          rootDir: root,
          taskId: "wi-300",
          recoverySafetyStateReader: createCliTaskRecoverySafetyStateReader({
            gitExecutable,
          }),
        }),
      ).rejects.toMatchObject({
        code: "TASK_RECOVERY_GIT_SAFETY_READ_FAILED",
        details: { fact: "status", operation: "status" },
      });

      const task = await loadTaskModel("wi-300", { rootDir: root });
      expect(task).toMatchObject({ status: "paused", statusReason: "blocked" });
      const store = openRuntimeSqliteStore({ rootDir: root });
      try {
        expect(store.listClaims()).toEqual([]);
        expect(store.listLocks()).toEqual([]);
        expect(store.listExecutionLogEntries()).toHaveLength(1);
      } finally {
        store.close();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("recovers halted tasks through the default es-git safety reader", async () => {
    const root = await createRecoverableTaskFixture();
    const readSafetyState = vi.spyOn(
      esGitTaskRecoverySafetyStateReader,
      "readSafetyState",
    );
    try {
      const recovered = await recoverTaskClaim({
        rootDir: root,
        taskId: "wi-300",
      });

      expect(recovered).toMatchObject({
        taskId: "wi-300",
        dryRun: false,
        executionLogEntry: {
          state: "completed",
          reason: "success",
        },
        transition: {
          dryRun: false,
          frontmatter: {
            status: "ready",
            status_reason: "recoverable",
          },
        },
      });
      expect(readSafetyState).toHaveBeenCalledOnce();
      expect(readSafetyState).toHaveBeenCalledWith({ rootDir: root });

      const store = openRuntimeSqliteStore({ rootDir: root });
      try {
        expect(store.listClaims()).toHaveLength(0);
        expect(store.listLocks()).toHaveLength(0);
        expect(store.listExecutionLogEntries()).toHaveLength(3);
        expect(store.listExecutionLogEntries()[2]).toMatchObject({
          claim_token: recovered.claimToken,
          state: "completed",
          reason: "success",
        });
      } finally {
        store.close();
      }
      const task = await loadTaskModel("wi-300", { rootDir: root });
      expect(task.status).toBe("ready");
      expect(task.statusReason).toBe("recoverable");
      expect(task.runtime).toMatchObject({
        executionReady: true,
        ready: true,
        latestExecutionLog: {
          state: "completed",
          reason: "success",
        },
      });
    } finally {
      readSafetyState.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("recovers a halted task through the CLI within the latency budget", async () => {
    const root = await createRecoverableTaskFixture();
    try {
      const startedAt = performance.now();
      const output = JSON.parse(
        runCli(
          root,
          ["work", "wi-300", "recover", "--json"],
          undefined,
          undefined,
          { timeout: RECOVERY_CLI_LATENCY_BUDGET_MS },
        ),
      ) as {
        executionLogEntry: {
          state: string;
          reason: string;
        };
        transition: {
          dryRun: boolean;
          frontmatter: {
            status: string;
            status_reason: string;
          };
        };
      };
      const elapsedMs = performance.now() - startedAt;

      expect(elapsedMs).toBeLessThanOrEqual(RECOVERY_CLI_LATENCY_BUDGET_MS);
      expect(output).not.toHaveProperty("recoveryTrace");
      expect(output).toMatchObject({
        executionLogEntry: {
          state: "completed",
          reason: "success",
        },
        transition: {
          dryRun: false,
          frontmatter: {
            status: "ready",
            status_reason: "recoverable",
          },
        },
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["CLI fallback", cliClaimedPathGitAuditAdapter],
    ["es-git", esGitClaimedPathGitAuditAdapter],
  ] as Array<[string, ClaimedPathGitAuditAdapter]>)(
    "fails closed before claim or transition side effects when %s metadata read fails",
    async (_name, gitAuditAdapter) => {
      const root = await createRecoverableTaskFixture();
      const taskPath = path.join(root, "backlog", "300-recoverable-task.md");
      const gitDirectory = path.join(root, ".git");
      const unavailableGitDirectory = `${gitDirectory}.unavailable`;
      await fs.writeFile(
        taskPath,
        (await fs.readFile(taskPath, "utf8"))
          .replace("status: paused", "status: ready")
          .replace("status_reason: blocked", "status_reason: recoverable"),
        "utf8",
      );
      execFileSync("git", ["add", taskPath], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "chore: mark recoverable"], {
        cwd: root,
        stdio: "ignore",
      });
      const sourceBeforeRecovery = await fs.readFile(taskPath, "utf8");
      const trace = createRecoveryTrace();
      const safetyReader = createCliTaskRecoverySafetyStateReader();
      const recoverySafetyStateReader = {
        async readSafetyState({ rootDir }: { rootDir: string }) {
          const state = await safetyReader.readSafetyState({ rootDir });
          await fs.rename(gitDirectory, unavailableGitDirectory);
          return state;
        },
      };
      try {
        await expect(
          recoverTaskClaim({
            rootDir: root,
            taskId: "wi-300",
            branch: "sandcastle/issue-300",
            worktree: root,
            gitAuditAdapter,
            recoverySafetyStateReader,
            trace,
          }),
        ).rejects.toMatchObject({
          code: "TASK_RECOVERY_CLAIMED_PATH_GIT_METADATA_UNAVAILABLE",
          details: { taskId: "wi-300" },
        });
      } finally {
        await fs.rename(unavailableGitDirectory, gitDirectory);
      }

      expect(await fs.readFile(taskPath, "utf8")).toBe(sourceBeforeRecovery);
      expect(trace.stages.claimAcquisition.invocationCount).toBe(0);
      expect(trace.stages.dryRunTransition.invocationCount).toBe(0);
      expect(trace.stages.appliedTransition.invocationCount).toBe(0);
      const store = openRuntimeSqliteStore({ rootDir: root });
      try {
        expect(store.listClaims()).toEqual([]);
        expect(store.listLocks()).toEqual([]);
        expect(store.listExecutionLogEntries()).toHaveLength(1);
      } finally {
        store.close();
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it.each([
    {
      name: "ready non-force recovery",
      status: "ready",
      statusReason: "recoverable",
    },
    {
      name: "paused recovery",
      status: "paused",
      statusReason: "blocked",
    },
    {
      name: "running recovery",
      status: "running",
      statusReason: "blocked",
    },
    {
      name: "force reset recovery",
      status: "paused",
      statusReason: "blocked",
      force: "reset" as const,
      dirtyFile: "recovery-dirty.txt",
    },
  ])(
    "fails closed before every side effect for injected claimed-path metadata failures during $name",
    async ({ status, statusReason, force, dirtyFile }) => {
      const root = await createRecoverableTaskFixture();
      const taskPath = path.join(root, "backlog", "300-recoverable-task.md");
      try {
        if (status !== "paused" || statusReason !== "blocked") {
          await fs.writeFile(
            taskPath,
            (await fs.readFile(taskPath, "utf8"))
              .replace("status: paused", `status: ${status}`)
              .replace(
                "status_reason: blocked",
                `status_reason: ${statusReason}`,
              ),
            "utf8",
          );
          execFileSync("git", ["add", taskPath], {
            cwd: root,
            stdio: "ignore",
          });
          execFileSync("git", ["commit", "-m", "chore: set recovery status"], {
            cwd: root,
            stdio: "ignore",
          });
        }
        if (dirtyFile) {
          await fs.writeFile(
            path.join(root, dirtyFile),
            "must not be cleaned\n",
            "utf8",
          );
        }

        const taskSourceBeforeRecovery = await fs.readFile(taskPath, "utf8");
        const dirtySourceBeforeRecovery = dirtyFile
          ? await fs.readFile(path.join(root, dirtyFile), "utf8")
          : undefined;
        const trace = createRecoveryTrace();
        const gitAuditAdapter: ClaimedPathGitAuditAdapter = {
          readMetadata: vi.fn(async () => {
            throw new Error("injected claimed-path metadata failure");
          }),
        };

        await expect(
          recoverTaskClaim({
            rootDir: root,
            taskId: "wi-300",
            branch: "sandcastle/issue-300",
            worktree: root,
            ...(force ? { force } : {}),
            gitAuditAdapter,
            trace,
          }),
        ).rejects.toMatchObject({
          code: "TASK_RECOVERY_CLAIMED_PATH_GIT_METADATA_UNAVAILABLE",
          details: { taskId: "wi-300" },
        });

        expect(gitAuditAdapter.readMetadata).toHaveBeenCalledWith(root);
        expect(await fs.readFile(taskPath, "utf8")).toBe(
          taskSourceBeforeRecovery,
        );
        if (dirtyFile) {
          expect(await fs.readFile(path.join(root, dirtyFile), "utf8")).toBe(
            dirtySourceBeforeRecovery,
          );
        }
        expect(trace.stages.claimAcquisition.invocationCount).toBe(0);
        expect(trace.stages.dryRunTransition.invocationCount).toBe(0);
        expect(trace.stages.appliedTransition.invocationCount).toBe(0);
        const store = openRuntimeSqliteStore({ rootDir: root });
        try {
          expect(store.listClaims()).toEqual([]);
          expect(store.listLocks()).toEqual([]);
          expect(store.listExecutionLogEntries()).toHaveLength(1);
        } finally {
          store.close();
        }
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it("reuses preflighted claimed-path audit facts during recovery authorization", async () => {
    const root = await createRecoverableTaskFixture();
    const legacyAudit = vi
      .spyOn(RuntimeSqliteStore.prototype, "auditClaimedPaths")
      .mockImplementation(() => {
        throw new Error("legacy claimed-path metadata read must not run");
      });
    const gitAuditAdapter: ClaimedPathGitAuditAdapter = {
      readMetadata: vi.fn(async () => ({
        branch: "sandcastle/issue-300",
        detached: false,
      })),
    };
    try {
      await expect(
        recoverTaskClaim({
          rootDir: root,
          taskId: "wi-300",
          branch: "sandcastle/issue-300",
          worktree: root,
          gitAuditAdapter,
        }),
      ).resolves.toMatchObject({
        taskId: "wi-300",
        executionLogEntry: { state: "completed", reason: "success" },
      });

      expect(gitAuditAdapter.readMetadata).toHaveBeenCalledTimes(1);
      expect(legacyAudit).not.toHaveBeenCalled();
      const task = await loadTaskModel("wi-300", { rootDir: root });
      expect(task).toMatchObject({
        status: "ready",
        statusReason: "recoverable",
      });
    } finally {
      legacyAudit.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed before authorization when claimed-path preflight cannot produce audit facts", async () => {
    const root = await createRecoverableTaskFixture();
    const legacyAudit = vi.spyOn(
      RuntimeSqliteStore.prototype,
      "auditClaimedPaths",
    );
    const gitAuditAdapter: ClaimedPathGitAuditAdapter = {
      readMetadata: vi.fn(async () => {
        throw new Error("claimed-path metadata unavailable");
      }),
    };
    const taskPath = path.join(root, "backlog", "300-recoverable-task.md");
    const sourceBeforeRecovery = await fs.readFile(taskPath, "utf8");
    try {
      await expect(
        recoverTaskClaim({
          rootDir: root,
          taskId: "wi-300",
          branch: "sandcastle/issue-300",
          worktree: root,
          gitAuditAdapter,
        }),
      ).rejects.toMatchObject({
        code: "TASK_RECOVERY_CLAIMED_PATH_GIT_METADATA_UNAVAILABLE",
      });

      expect(gitAuditAdapter.readMetadata).toHaveBeenCalledTimes(1);
      expect(legacyAudit).not.toHaveBeenCalled();
      expect(await fs.readFile(taskPath, "utf8")).toBe(sourceBeforeRecovery);
    } finally {
      legacyAudit.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("uses the es-git adapter by default for regular recoverable recovery", async () => {
    const root = await createRecoverableTaskFixture();
    const taskPath = path.join(root, "backlog", "300-recoverable-task.md");
    await fs.writeFile(
      taskPath,
      (await fs.readFile(taskPath, "utf8"))
        .replace("status: paused", "status: ready")
        .replace("status_reason: blocked", "status_reason: recoverable"),
      "utf8",
    );
    execFileSync("git", ["add", taskPath], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "chore: mark recoverable"], {
      cwd: root,
      stdio: "ignore",
    });
    const readMetadata = vi.spyOn(
      esGitClaimedPathGitAuditAdapter,
      "readMetadata",
    );
    try {
      await expect(
        recoverTaskClaim({
          rootDir: root,
          taskId: "wi-300",
          branch: "sandcastle/issue-300",
          worktree: root,
        }),
      ).resolves.toMatchObject({
        taskId: "wi-300",
        executionLogEntry: { state: "completed" },
      });
      expect(readMetadata).toHaveBeenCalledWith(root);
    } finally {
      readMetadata.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("recovers a detached recoverable task with the default es-git adapter", async () => {
    const root = await createRecoverableTaskFixture();
    const taskPath = path.join(root, "backlog", "300-recoverable-task.md");
    await fs.writeFile(
      taskPath,
      (await fs.readFile(taskPath, "utf8"))
        .replace("status: paused", "status: ready")
        .replace("status_reason: blocked", "status_reason: recoverable"),
      "utf8",
    );
    execFileSync("git", ["add", taskPath], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "chore: mark recoverable"], {
      cwd: root,
      stdio: "ignore",
    });
    const oid = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["checkout", "--detach", oid], {
      cwd: root,
      stdio: "ignore",
    });
    try {
      await expect(
        recoverTaskClaim({
          rootDir: root,
          taskId: "wi-300",
          worktree: root,
        }),
      ).resolves.toMatchObject({
        taskId: "wi-300",
        executionLogEntry: { state: "completed" },
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("reads claimed-path audit metadata from the linked recovery worktree while sharing the primary authority", async () => {
    const root = await mkTmpRoot();
    const linkedWorktree = await fs.mkdtemp(
      path.join(os.tmpdir(), "doc-vader-linked-recovery-"),
    );
    await fs.rm(linkedWorktree, { recursive: true, force: true });
    try {
      initGitRepo(root);
      await fs.writeFile(path.join(root, "README.md"), "base\n", "utf8");
      await fs.writeFile(
        path.join(root, ".gitignore"),
        ".doc-vader/runtime/\n",
        "utf8",
      );
      await writeTask(
        root,
        "301-linked-recoverable-task.md",
        `id: wi-301
title: Linked Recoverable Task
type: work-item
lifecycle: active
status: paused
status_reason: blocked
tags:
  - afk`,
      );
      execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "chore: base"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync(
        "git",
        ["worktree", "add", "-b", "sandcastle/issue-301", linkedWorktree],
        { cwd: root, stdio: "ignore" },
      );
      const taskPath = path.join(
        linkedWorktree,
        "backlog",
        "301-linked-recoverable-task.md",
      );
      await fs.writeFile(
        taskPath,
        (await fs.readFile(taskPath, "utf8"))
          .replace("status: paused", "status: ready")
          .replace("status_reason: blocked", "status_reason: recoverable"),
        "utf8",
      );
      execFileSync("git", ["add", taskPath], {
        cwd: linkedWorktree,
        stdio: "ignore",
      });
      execFileSync("git", ["commit", "-m", "chore: mark recoverable"], {
        cwd: linkedWorktree,
        stdio: "ignore",
      });
      recordRuntimeExecutionLog(root, {
        claim_token: "claim-wi-301",
        target_type: "task",
        target_id: "wi-301",
        state: "halted",
        reason: "blocked",
        created_at: "2026-06-15T12:00:00.000Z",
        detail: {
          code: "x-runtime-task-blocked",
          message: "Paused for linked-worktree recovery.",
        },
      });
      const readMetadata = vi.spyOn(
        esGitClaimedPathGitAuditAdapter,
        "readMetadata",
      );
      try {
        await expect(
          recoverTaskClaim({
            rootDir: linkedWorktree,
            taskId: "wi-301",
            branch: "sandcastle/issue-301",
            worktree: linkedWorktree,
          }),
        ).resolves.toMatchObject({
          taskId: "wi-301",
          executionLogEntry: { state: "completed" },
        });
        expect(readMetadata).toHaveBeenCalledWith(linkedWorktree);
      } finally {
        readMetadata.mockRestore();
      }

      const authorityStore = openRuntimeSqliteStore({ rootDir: root });
      try {
        expect(authorityStore.listExecutionLogEntries()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              target_id: "wi-301",
              state: "completed",
            }),
          ]),
        );
      } finally {
        authorityStore.close();
      }
    } finally {
      await fs.rm(linkedWorktree, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "an unmerged conflict",
      status: "paused",
      blockedReasons: ["merge-in-progress", "unmerged-paths"],
    },
    {
      name: "a merge in progress",
      status: "running",
      blockedReasons: ["merge-in-progress"],
    },
    {
      name: "a rebase in progress",
      status: "paused",
      blockedReasons: ["rebase-in-progress"],
    },
    {
      name: "a git am in progress while paused",
      status: "paused",
      blockedReasons: ["rebase-in-progress"],
      force: "reset" as const,
    },
    {
      name: "a git am in progress while running",
      status: "running",
      blockedReasons: ["rebase-in-progress"],
      force: "reconcile" as const,
    },
  ])(
    "fails closed with the default es-git reader before side effects for $name",
    async ({ name, status, blockedReasons, force }) => {
      const root = await createRecoverableTaskFixture();
      const taskPath = path.join(root, "backlog", "300-recoverable-task.md");
      const readSafetyState = vi.spyOn(
        esGitTaskRecoverySafetyStateReader,
        "readSafetyState",
      );
      try {
        if (status === "running") {
          await fs.writeFile(
            taskPath,
            (await fs.readFile(taskPath, "utf8")).replace(
              "status: paused",
              "status: running",
            ),
            "utf8",
          );
          execFileSync("git", ["add", taskPath], {
            cwd: root,
            stdio: "ignore",
          });
          execFileSync("git", ["commit", "-m", "chore: set running"], {
            cwd: root,
            stdio: "ignore",
          });
        }

        switch (name) {
          case "an unmerged conflict":
            execFileSync("git", ["switch", "main"], {
              cwd: root,
              stdio: "ignore",
            });
            await fs.writeFile(
              path.join(root, "conflict.txt"),
              "main\n",
              "utf8",
            );
            execFileSync("git", ["add", "conflict.txt"], {
              cwd: root,
              stdio: "ignore",
            });
            execFileSync("git", ["commit", "-m", "chore: main conflict"], {
              cwd: root,
              stdio: "ignore",
            });
            execFileSync("git", ["switch", "sandcastle/issue-300"], {
              cwd: root,
              stdio: "ignore",
            });
            await fs.writeFile(
              path.join(root, "conflict.txt"),
              "branch\n",
              "utf8",
            );
            execFileSync("git", ["add", "conflict.txt"], {
              cwd: root,
              stdio: "ignore",
            });
            execFileSync("git", ["commit", "-m", "chore: branch conflict"], {
              cwd: root,
              stdio: "ignore",
            });
            expect(() =>
              execFileSync("git", ["merge", "main"], {
                cwd: root,
                stdio: "ignore",
              }),
            ).toThrow();
            break;
          case "a merge in progress":
            execFileSync("git", ["switch", "main"], {
              cwd: root,
              stdio: "ignore",
            });
            await fs.writeFile(
              path.join(root, "main-only.txt"),
              "main\n",
              "utf8",
            );
            execFileSync("git", ["add", "main-only.txt"], {
              cwd: root,
              stdio: "ignore",
            });
            execFileSync("git", ["commit", "-m", "chore: main change"], {
              cwd: root,
              stdio: "ignore",
            });
            execFileSync("git", ["switch", "sandcastle/issue-300"], {
              cwd: root,
              stdio: "ignore",
            });
            execFileSync("git", ["merge", "--no-commit", "main"], {
              cwd: root,
              stdio: "ignore",
            });
            break;
          case "a rebase in progress":
            execFileSync("git", ["switch", "main"], {
              cwd: root,
              stdio: "ignore",
            });
            await fs.writeFile(
              path.join(root, "main-only.txt"),
              "main\n",
              "utf8",
            );
            execFileSync("git", ["add", "main-only.txt"], {
              cwd: root,
              stdio: "ignore",
            });
            execFileSync("git", ["commit", "-m", "chore: main change"], {
              cwd: root,
              stdio: "ignore",
            });
            execFileSync("git", ["switch", "sandcastle/issue-300"], {
              cwd: root,
              stdio: "ignore",
            });
            expect(() =>
              execFileSync("git", ["rebase", "main", "--exec", "false"], {
                cwd: root,
                stdio: "ignore",
              }),
            ).toThrow();
            break;
          case "a git am in progress while paused":
          case "a git am in progress while running": {
            execFileSync("git", ["switch", "main"], {
              cwd: root,
              stdio: "ignore",
            });
            await fs.writeFile(
              path.join(root, "README.md"),
              "mailbox\n",
              "utf8",
            );
            execFileSync("git", ["add", "README.md"], {
              cwd: root,
              stdio: "ignore",
            });
            execFileSync("git", ["commit", "-m", "chore: mailbox change"], {
              cwd: root,
              stdio: "ignore",
            });
            const mailbox = execFileSync(
              "git",
              ["format-patch", "--stdout", "-1", "HEAD"],
              { cwd: root, encoding: "utf8" },
            );
            execFileSync("git", ["switch", "sandcastle/issue-300"], {
              cwd: root,
              stdio: "ignore",
            });
            await fs.writeFile(
              path.join(root, "README.md"),
              "feature\n",
              "utf8",
            );
            execFileSync("git", ["add", "README.md"], {
              cwd: root,
              stdio: "ignore",
            });
            execFileSync("git", ["commit", "-m", "chore: feature change"], {
              cwd: root,
              stdio: "ignore",
            });
            expect(() =>
              execFileSync("git", ["am", "--3way", "-"], {
                cwd: root,
                input: mailbox,
                stdio: ["pipe", "ignore", "ignore"],
              }),
            ).toThrow();
            break;
          }
        }
        const protectedDirtyPath = path.join(root, "must-not-delete.txt");
        await fs.writeFile(protectedDirtyPath, "preserve me\n", "utf8");
        const taskSourceBeforeRecovery = await fs.readFile(taskPath, "utf8");
        const gitStatusBeforeRecovery = execFileSync(
          "git",
          ["status", "--porcelain=v1", "-uall"],
          { cwd: root, encoding: "utf8" },
        );
        const trace = createRecoveryTrace();

        await expect(
          recoverTaskClaim({
            rootDir: root,
            taskId: "wi-300",
            force: force ?? "reset",
            trace,
          }),
        ).rejects.toMatchObject({
          code: "TASK_RECOVERY_RESUME_BLOCKED",
          details: {
            taskId: "wi-300",
            resumeBlockedReasons: expect.arrayContaining(blockedReasons),
          },
        });

        expect(readSafetyState).toHaveBeenCalledOnce();
        expect(readSafetyState).toHaveBeenCalledWith({ rootDir: root });
        expect(await fs.readFile(protectedDirtyPath, "utf8")).toBe(
          "preserve me\n",
        );
        expect(await fs.readFile(taskPath, "utf8")).toBe(
          taskSourceBeforeRecovery,
        );
        expect(
          execFileSync("git", ["status", "--porcelain=v1", "-uall"], {
            cwd: root,
            encoding: "utf8",
          }),
        ).toBe(gitStatusBeforeRecovery);
        expect(trace.stages.claimAcquisition.invocationCount).toBe(0);
        expect(trace.stages.dryRunTransition.invocationCount).toBe(0);
        expect(trace.stages.appliedTransition.invocationCount).toBe(0);
        const store = openRuntimeSqliteStore({ rootDir: root });
        try {
          expect(store.listClaims()).toEqual([]);
          expect(store.listLocks()).toEqual([]);
          expect(store.listExecutionLogEntries()).toHaveLength(1);
        } finally {
          store.close();
        }
      } finally {
        readSafetyState.mockRestore();
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it("profiles task recovery CLI latency by component", async () => {
    const root = await createRecoverableTaskFixture();
    try {
      const profile = await profileTaskRecoveryLatency(root);

      expect(profile.operationOnlyMs).toBeLessThanOrEqual(
        RECOVERY_CLI_LATENCY_BUDGET_MS,
      );
      expect(profile.dominantStage).toBeDefined();
      expect(profile.stages).toEqual(
        expect.objectContaining({
          cliTsxBootstrap: expect.any(Object),
          taskRuntimeLoading: expect.any(Object),
          gitSafetyState: expect.any(Object),
          claimAcquisition: expect.any(Object),
          dryRunTransition: expect.any(Object),
          appliedTransition: expect.any(Object),
          runtimeClaimSqliteAuthorityOpen: expect.any(Object),
          claimLookup: expect.any(Object),
          scopeLockLookup: expect.any(Object),
          gitRevParseAbbrevRefHead: expect.any(Object),
          gitRevParseHead: expect.any(Object),
          requiredPathNormalization: expect.any(Object),
          lockOwnershipDecision: expect.any(Object),
        }),
      );
      for (const stage of RECOVERY_LATENCY_STAGES) {
        expect(profile.stages[stage].durationMs).toBeGreaterThanOrEqual(0);
        expect(profile.stages[stage].invocationCount).toBeGreaterThan(0);
      }
      const recoveryStageDurationMs = RECOVERY_LATENCY_STAGES.filter(
        (stage) => stage !== "cliTsxBootstrap",
      ).reduce((total, stage) => total + profile.stages[stage].durationMs, 0);
      expect(recoveryStageDurationMs).toBeLessThanOrEqual(
        profile.operationOnlyMs,
      );
      expect(profile.dominantStage).toBe(
        findDominantRecoveryLatencyStage(profile),
      );
      expect(profile.dominantAuditSubspan).toBe(
        findDominantRecoveryAuditSubspan(profile),
      );
      console.info("task recovery latency profile", profile);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 15_000);

  it(
    "refuses dirty recovery without force",
    { timeout: integrationTestTimeoutMs() },
    async () => {
      const root = await mkTmpRoot();
      try {
        initGitRepo(root);
        await fs.writeFile(
          path.join(root, ".gitignore"),
          ".doc-vader/runtime/\n",
          "utf8",
        );
        await writeTask(
          root,
          "301-dirty-recovery-task.md",
          `id: wi-301
title: Dirty Recovery Task
type: work-item
lifecycle: active
status: paused
status_reason: blocked
tags:
  - afk`,
        );
        execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
        execFileSync("git", ["commit", "-m", "chore: base"], {
          cwd: root,
          stdio: "ignore",
        });
        recordRuntimeExecutionLog(root, {
          claim_token: "claim-wi-301",
          target_type: "task",
          target_id: "wi-301",
          state: "halted",
          reason: "blocked",
          created_at: "2026-06-15T12:00:00.000Z",
          detail: {
            code: "x-runtime-task-blocked",
            message: "Paused for recovery.",
          },
        });
        await fs.writeFile(path.join(root, "notes.txt"), "dirty\n", "utf8");

        expect(() =>
          runCli(root, ["work", "wi-301", "recover", "--json"]),
        ).toThrow(/TASK_RECOVERY_DIRTY_WORKTREE/);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it("recovers when only force-added operational runtime and agent artifacts are dirty", async () => {
    const root = await mkTmpRoot();
    try {
      initGitRepo(root);
      await fs.writeFile(
        path.join(root, ".gitignore"),
        ".doc-vader/runtime/\n.pi/\n",
        "utf8",
      );
      await writeTask(
        root,
        "60462-operational-recovery.md",
        `id: wi-60462-recovery
title: Operational Recovery
type: work-item
lifecycle: active
status: paused
status_reason: blocked
tags:
  - afk`,
      );
      execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "chore: base"], {
        cwd: root,
        stdio: "ignore",
      });
      recordRuntimeExecutionLog(root, {
        claim_token: "claim-wi-60462-recovery",
        target_type: "task",
        target_id: "wi-60462-recovery",
        state: "halted",
        reason: "blocked",
        created_at: "2026-06-15T12:00:00.000Z",
        detail: {
          code: "x-runtime-task-blocked",
          message: "Paused for recovery.",
        },
      });
      await fs.mkdir(path.join(root, ".pi", "sessions"), { recursive: true });
      await fs.writeFile(
        path.join(root, ".pi", "sessions", "agent.json"),
        "{}\n",
        "utf8",
      );
      execFileSync(
        "git",
        [
          "add",
          "-f",
          ".doc-vader/runtime/runtime.sqlite",
          ".pi/sessions/agent.json",
        ],
        { cwd: root, stdio: "ignore" },
      );

      const gitState = collectTaskRecoveryGitState({
        rootDir: root,
        taskFilePath: "backlog/60462-operational-recovery.md",
      });
      expect(gitState.dirtyPaths).toEqual([]);
      expect(gitState.operationalArtifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ".doc-vader/runtime/runtime.sqlite",
            reason: "runtime-authority",
          }),
          expect.objectContaining({
            path: ".pi/sessions/agent.json",
            reason: "agent-local",
          }),
        ]),
      );

      const recovered = JSON.parse(
        runCli(root, ["work", "wi-60462-recovery", "recover", "--json"]),
      ) as {
        transition: { frontmatter: { status: string; status_reason: string } };
      };

      expect(recovered.transition.frontmatter).toMatchObject({
        status: "ready",
        status_reason: "recoverable",
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it(
    "supports force reset and reconcile recovery modes",
    { timeout: 15_000 },
    async () => {
      const rootClean = await mkTmpRoot();
      const rootReconcile = await mkTmpRoot();
      try {
        initGitRepo(rootClean);
        await fs.writeFile(path.join(rootClean, "README.md"), "base\n", "utf8");
        await fs.writeFile(
          path.join(rootClean, ".gitignore"),
          ".doc-vader/runtime/\n",
          "utf8",
        );
        execFileSync("git", ["add", "."], { cwd: rootClean, stdio: "ignore" });
        execFileSync("git", ["commit", "-m", "chore: base"], {
          cwd: rootClean,
          stdio: "ignore",
        });
        execFileSync("git", ["switch", "-c", "sandcastle/issue-302"], {
          cwd: rootClean,
          stdio: "ignore",
        });
        await writeTask(
          rootClean,
          "302-force-recovery-task.md",
          `id: wi-302
title: Force Recovery Task
type: work-item
lifecycle: active
status: paused
status_reason: blocked
tags:
  - afk`,
        );
        execFileSync("git", ["add", "backlog/302-force-recovery-task.md"], {
          cwd: rootClean,
          stdio: "ignore",
        });
        execFileSync("git", ["commit", "-m", "chore: base"], {
          cwd: rootClean,
          stdio: "ignore",
        });
        recordRuntimeExecutionLog(rootClean, {
          claim_token: "claim-wi-302",
          target_type: "task",
          target_id: "wi-302",
          state: "halted",
          reason: "blocked",
          created_at: "2026-06-15T12:00:00.000Z",
          detail: {
            code: "x-runtime-task-blocked",
            message: "Paused for recovery.",
          },
        });
        await fs.writeFile(
          path.join(rootClean, "notes.txt"),
          "dirty\n",
          "utf8",
        );

        const cleanOutput = JSON.parse(
          runCli(rootClean, ["work", "wi-302", "recover",
            "--force",
            "reset",
            "--json",
          ]),
        ) as {
          checkpoint?: unknown;
          transition: { frontmatter: { status_reason: string } };
        };
        expect(cleanOutput.transition.frontmatter.status_reason).toBe(
          "recoverable",
        );
        expect(cleanOutput.checkpoint).toBeUndefined();

        const store = openRuntimeSqliteStore({ rootDir: rootClean });
        try {
          expect(store.listClaims()).toHaveLength(0);
          expect(store.listLocks()).toHaveLength(0);
        } finally {
          store.close();
        }

        initGitRepo(rootReconcile);
        await fs.writeFile(
          path.join(rootReconcile, "README.md"),
          "base\n",
          "utf8",
        );
        await fs.writeFile(
          path.join(rootReconcile, ".gitignore"),
          ".doc-vader/runtime/\n",
          "utf8",
        );
        execFileSync("git", ["add", "."], {
          cwd: rootReconcile,
          stdio: "ignore",
        });
        execFileSync("git", ["commit", "-m", "chore: base"], {
          cwd: rootReconcile,
          stdio: "ignore",
        });
        execFileSync("git", ["switch", "-c", "sandcastle/issue-303"], {
          cwd: rootReconcile,
          stdio: "ignore",
        });
        await writeTask(
          rootReconcile,
          "303-reconcile-recovery-task.md",
          `id: wi-303
title: Reconcile Recovery Task
type: work-item
lifecycle: active
status: paused
status_reason: blocked
tags:
  - afk`,
        );
        execFileSync("git", ["add", "backlog/303-reconcile-recovery-task.md"], {
          cwd: rootReconcile,
          stdio: "ignore",
        });
        execFileSync("git", ["commit", "-m", "chore: base"], {
          cwd: rootReconcile,
          stdio: "ignore",
        });
        recordRuntimeExecutionLog(rootReconcile, {
          claim_token: "claim-wi-303-reconcile",
          target_type: "task",
          target_id: "wi-303",
          state: "halted",
          reason: "blocked",
          created_at: "2026-06-15T13:00:00.000Z",
          detail: {
            code: "x-runtime-task-blocked",
            message: "Paused for recovery again.",
          },
        });
        await fs.writeFile(
          path.join(rootReconcile, "notes-2.txt"),
          "dirty\n",
          "utf8",
        );

        const reconcileOutput = JSON.parse(
          runCli(rootReconcile, ["work", "wi-303", "recover",
            "--force",
            "reconcile",
            "--json",
          ]),
        ) as {
          checkpoint?: {
            filePath: string;
            mode: string;
          };
        };
        expect(reconcileOutput.checkpoint).toMatchObject({
          mode: "reconcile",
        });
        expect(reconcileOutput.checkpoint?.filePath).toContain(
          "recovery-checkpoints",
        );
        expect(
          await fs.readFile(reconcileOutput.checkpoint!.filePath, "utf8"),
        ).toContain('"mode": "reconcile"');
      } finally {
        await fs.rm(rootClean, { recursive: true, force: true });
        await fs.rm(rootReconcile, { recursive: true, force: true });
      }
    },
  );

  it(
    "rejects force recovery when unrelated dirty paths are present",
    { timeout: 30_000 },
    async () => {
      const root = await mkTmpRoot();
      try {
        initGitRepo(root);
        await fs.writeFile(path.join(root, "README.md"), "base\n", "utf8");
        await fs.writeFile(
          path.join(root, ".gitignore"),
          ".doc-vader/runtime/\n",
          "utf8",
        );
        execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
        execFileSync("git", ["commit", "-m", "chore: base"], {
          cwd: root,
          stdio: "ignore",
        });
        execFileSync("git", ["switch", "-c", "sandcastle/issue-305"], {
          cwd: root,
          stdio: "ignore",
        });
        await writeTask(
          root,
          "305-unrelated-dirty-recovery-task.md",
          `id: wi-305
title: Unrelated Dirty Recovery Task
type: work-item
lifecycle: active
status: paused
status_reason: blocked
tags:
  - afk`,
        );
        execFileSync(
          "git",
          ["add", "backlog/305-unrelated-dirty-recovery-task.md"],
          {
            cwd: root,
            stdio: "ignore",
          },
        );
        execFileSync("git", ["commit", "-m", "feat: task"], {
          cwd: root,
          stdio: "ignore",
        });
        recordRuntimeExecutionLog(root, {
          claim_token: "claim-wi-305",
          target_type: "task",
          target_id: "wi-305",
          state: "halted",
          reason: "blocked",
          created_at: "2026-06-15T12:00:00.000Z",
          detail: {
            code: "x-runtime-task-blocked",
            message: "Paused for recovery.",
            "x-dirty-paths": ["notes.txt"],
            "x-unlocked-paths": ["notes.txt"],
          },
        });
        await fs.writeFile(
          path.join(root, "notes.txt"),
          "owned dirty\n",
          "utf8",
        );
        await fs.writeFile(
          path.join(root, "extra.txt"),
          "unrelated dirty\n",
          "utf8",
        );

        for (const forceMode of ["reset", "reconcile"] as const) {
          expect(() =>
            runCli(root, ["work", "wi-305", "recover",
              "--force",
              forceMode,
              "--json",
            ]),
          ).toThrow(/TASK_RECOVERY_UNRELATED_DIRTY_PATHS/);
        }
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it("rejects force recovery when dirty paths are owned by another claim", async () => {
    const root = await mkTmpRoot();
    try {
      initGitRepo(root);
      await fs.writeFile(path.join(root, "README.md"), "base\n", "utf8");
      await fs.writeFile(
        path.join(root, ".gitignore"),
        ".doc-vader/runtime/\n",
        "utf8",
      );
      execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "chore: base"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync("git", ["switch", "-c", "sandcastle/issue-304"], {
        cwd: root,
        stdio: "ignore",
      });
      await writeTask(
        root,
        "304-force-conflict-task.md",
        `id: wi-304
title: Force Conflict Task
type: work-item
lifecycle: active
status: paused
status_reason: blocked
tags:
  - afk`,
      );
      execFileSync("git", ["add", "backlog/304-force-conflict-task.md"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync("git", ["commit", "-m", "feat: task"], {
        cwd: root,
        stdio: "ignore",
      });
      recordRuntimeExecutionLog(root, {
        claim_token: "claim-wi-304",
        target_type: "task",
        target_id: "wi-304",
        state: "halted",
        reason: "blocked",
        created_at: "2026-06-15T12:00:00.000Z",
        detail: {
          code: "x-runtime-task-blocked",
          message: "Paused for recovery.",
        },
      });
      await fs.writeFile(path.join(root, "notes.txt"), "dirty\n", "utf8");
      const store = openRuntimeSqliteStore({ rootDir: root });
      try {
        const foreignClaim = store.acquireRuntimeClaim(
          {
            schema_version: RUNTIME_SCHEMA_VERSION,
            target_type: "task",
            target_id: "wi-foreign",
            holder: "agent-b",
            created_at: "2026-06-15T12:10:00.000Z",
            expires_at: "2026-06-15T13:10:00.000Z",
            entropy: "entropy-foreign-force-conflict",
          },
          {
            initialLockPaths: ["notes.txt"],
          },
        );
        if (foreignClaim.outcome !== "acquired") {
          throw new Error("Expected the foreign claim to be acquired.");
        }
      } finally {
        store.close();
      }

      expect(() =>
        runCli(root, ["work", "wi-304", "recover",
          "--force",
          "reset",
          "--json",
        ]),
      ).toThrow(/TASK_RECOVERY_LOCK_CONFLICT/);
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

      const show = JSON.parse(runCli(root, ["work", "105", "show", "--json"]));
      expect(show.id).toBe("wi-105");
      const claim = await claimTask("wi-105", {
        rootDir: root,
        claimStorePath: claimStorePath(root),
        holder: "agent-a",
      });
      expect(claim).toMatchObject({ taskId: "wi-105", state: "active" });
      const store = openRuntimeSqliteStore({ rootDir: root });
      try {
        expect(
          store.listLocksByClaimToken(claim.claimId).map((lock) => lock.path),
        ).toEqual(["backlog/105-cli-task.md"]);
      } finally {
        store.close();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects partial or non-positive claim TTL values", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "105-ttl-claim.md",
        `id: wi-105-ttl
title: TTL Claim
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );

      let output = "";
      try {
        runCli(root, ["work", "105-ttl", "claim",
          "--ttl-minutes",
          "10abc",
          "--json",
        ]);
      } catch (error) {
        const processError = error as { stdout?: unknown; stderr?: unknown };
        output = [processError.stdout, processError.stderr]
          .map((value) => String(value ?? ""))
          .join("\n");
      }

      expect(output).toContain("TASK_CLAIM_INVALID_TTL");
      expect(output).toContain("positive whole number");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it(
    "reports execution disagreement in task show JSON and operational task status",
    { timeout: 30_000 },
    async () => {
      const root = await mkTmpRoot();
      try {
        await writeTask(
          root,
          "106-runtime-disagreement.md",
          `id: wi-106
title: Runtime Disagreement
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
        );
        recordRuntimeExecutionLog(root, {
          claim_token: "claim-wi-106",
          target_type: "task",
          target_id: "wi-106",
          state: "halted",
          reason: "blocked",
          created_at: "2026-06-15T12:00:00.000Z",
          detail: {
            code: "x-runtime-task-blocked",
            message: "Blocked by runtime execution.",
          },
        });

        const show = JSON.parse(
          runCli(root, ["work", "106", "show", "--json"]),
        );
        const status = JSON.parse(
          runCli(root, ["work", "106", "status", "--json"]),
        );
        expect(show.runtime).toMatchObject({
          markdownReady: true,
          executionReady: false,
          ready: false,
          sourceDisagreement: true,
          latestExecutionLog: {
            claimToken: "claim-wi-106",
            targetId: "wi-106",
            state: "halted",
            reason: "blocked",
            readyPermitting: false,
          },
        });
        expect(status).toMatchObject({
          schemaVersion: "task-status/v1",
          id: "wi-106",
          title: "Runtime Disagreement",
          status: "ready",
          runtime: show.runtime,
          recovery: {
            state: "force-required",
            forceRequired: true,
            forceReasons: ["lineage-unknown"],
            blockedReasons: [],
          },
        });
        const statusWithWorktree = JSON.parse(
          runCli(root, ["work", "106", "status", "--worktree", root, "--json"]),
        );
        expect(statusWithWorktree).toMatchObject({
          recovery: {
            state: "recoverable",
            forceRequired: false,
            forceReasons: [],
            gitState: {
              worktreeLineageKnown: true,
              lineageKnown: true,
            },
          },
        });
        expect(status.body).toBeUndefined();
        expect(status.bodySections).toBeUndefined();
        expect(status.acceptanceCriteria).toBeUndefined();
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "reports graph-informed status facts while keeping informational references diagnostic-only",
    { timeout: 15_000 },
    async () => {
      const root = await mkTmpRoot();
      try {
        ensureRuntimeClaimAuthority(root);
        await writeTask(
          root,
          "108-graph-status.md",
          `id: wi-108
title: Graph Status
type: work-item
lifecycle: active
status: ready
tags:
  - afk
links:
  depends_on:
    - '[[wi-109]]'
  part_of:
    - '[[project:graph-status]]'
  implements:
    - '[[../docs/how-to/implementation-plans/graph-status-prd.md]]'
  reference:
    - '[[\`wi-110#context\`]]'`,
          `## Goal

Inspect graph-informed task status.
`,
        );
        await writeTask(
          root,
          "109-graph-dependency.md",
          `id: wi-109
title: Graph Dependency
type: work-item
lifecycle: active
status: completed
status_reason: completed
tags:
  - afk`,
        );
        await writeTask(
          root,
          "110-graph-reference.md",
          `id: wi-110
title: Graph Reference
type: work-item
lifecycle: active
status: blocked
tags:
  - afk`,
        );
        await fs.mkdir(
          path.join(root, "docs", "how-to", "implementation-plans"),
          { recursive: true },
        );
        await fs.writeFile(
          path.join(root, "docs", "project-graph-status.md"),
          `---
id: project:graph-status
title: Graph Status Project
type: project
subtype: initiative
lifecycle: active
status: ready
---

## Goal

Anchor the status relationship graph.
`,
          "utf8",
        );
        await fs.writeFile(
          path.join(
            root,
            "docs",
            "how-to",
            "implementation-plans",
            "graph-status-prd.md",
          ),
          `---
id: graph-status-prd
title: Graph Status PRD
type: plan
subtype: x-prd
lifecycle: active
status: ready
---

## Goal

Trigger a projection diagnostic for status.
`,
          "utf8",
        );

        const status = runCliJson<{
          schemaVersion: string;
          id: string;
          runtime: {
            markdownReady: boolean;
            executionReady: boolean;
            ready: boolean;
          };
          recovery: {
            state: string;
            forceRequired: boolean;
            blockedReasons: string[];
            forceReasons: string[];
          };
          graph: {
            relationships: Array<{ type: string; target: string }>;
            diagnostics: {
              projection: Array<{
                scope: string;
                sourceKey: string;
                target: string;
                classification: string;
                reasonCode: string;
                relativePath?: string;
                documentId?: string;
              }>;
              informationalReferences: Array<{
                type: string;
                sourceKey: string;
                target: string;
                resolvedTargetId: string;
              }>;
            };
          };
        }>(root, ["work", "108", "status", "--json"]);
        const statusText = runCli(root, ["work", "108", "status"]);

        expect(status).toMatchObject({
          schemaVersion: "task-status/v1",
          id: "wi-108",
          runtime: {
            markdownReady: true,
            executionReady: true,
            ready: true,
          },
          recovery: {
            state: "ready",
            forceRequired: false,
            blockedReasons: [],
            forceReasons: [],
          },
        });
        expect(status.graph.relationships).toEqual([
          {
            type: "belongs_to",
            target: "[[project:graph-status]]",
          },
          {
            type: "depends_on",
            target: "[[wi-109]]",
          },
        ]);
        expect(status.graph.diagnostics.projection).toEqual([
          {
            scope: "formal",
            sourceKey: "implements",
            target:
              "[[../docs/how-to/implementation-plans/graph-status-prd.md]]",
            classification: "unsupported",
            reasonCode: "non-canonical-document-id",
            relativePath:
              "docs/how-to/implementation-plans/graph-status-prd.md",
            documentId: "graph-status-prd",
          },
        ]);
        expect(status.graph.diagnostics.informationalReferences).toEqual([
          {
            type: "references",
            sourceKey: "reference",
            target: "[[`wi-110#context`]]",
            resolvedTargetId: "wi:110",
          },
        ]);
        expect(statusText).toContain("Graph");
        expect(statusText).toContain(
          "- relationships: belongs_to=[[project:graph-status]], depends_on=[[wi-109]]",
        );
        expect(statusText).toContain(
          "- informational references: reference=[[`wi-110#context`]]",
        );
        expect(statusText).toContain(
          "- projection diagnostics: implements=[[../docs/how-to/implementation-plans/graph-status-prd.md]] (non-canonical-document-id)",
        );

        const claimed = JSON.parse(
          runCli(root, ["work", "108", "claim",
            "--holder",
            "agent-a",
            "--json",
          ]),
        ) as {
          outcome: string;
          executionLogEntry: {
            state: string;
            reason: string;
          };
        };
        expect(claimed).toMatchObject({
          outcome: "acquired",
          executionLogEntry: {
            state: "running",
            reason: "started",
          },
        });
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "keeps work, wi, and task status output aligned without mutating graph or runtime state",
    { timeout: 15_000 },
    async () => {
      const root = await mkTmpRoot();
      try {
        await stageWorkGraphUacFixture(root);
        const before = await snapshotFiles(root);

        const statusJsonByAlias = new Map(
          WORK_COMMAND_ALIASES.map((alias) => [
            alias,
            runCliJson<{
              graph: {
                relationships: Array<{ type: string; target: string }>;
                diagnostics: {
                  projection: Array<{ reasonCode: string }>;
                  informationalReferences: Array<{
                    type: string;
                    sourceKey: string;
                    target: string;
                    resolvedTargetId: string;
                  }>;
                };
              };
            }>(root, [alias, "70001", "status", "--json"]),
          ]),
        );
        const statusTextByAlias = new Map(
          WORK_COMMAND_ALIASES.map((alias) => [
            alias,
            runCli(root, [alias, "70001", "status"]),
          ]),
        );

        const [canonicalAlias, ...compatibilityAliases] = WORK_COMMAND_ALIASES;
        const canonicalJson = statusJsonByAlias.get(canonicalAlias);
        const canonicalText = statusTextByAlias.get(canonicalAlias);
        expect(canonicalJson?.graph.relationships).toEqual([
          {
            type: "belongs_to",
            target: "[[project-work-graph-uac-review]]",
          },
          {
            type: "depends_on",
            target: "[[70002-work-graph-uac-dependency]]",
          },
          {
            type: "depends_on",
            target: "[[wi-70002]]",
          },
          {
            type: "implements",
            target:
              "[[../docs/how-to/implementation-plans/work-graph-uac-review-prd.md]]",
          },
        ]);
        expect(canonicalJson?.graph.diagnostics.projection).toEqual([]);
        expect(
          canonicalJson?.graph.diagnostics.informationalReferences,
        ).toEqual([
          {
            type: "references",
            sourceKey: "reference",
            target: "[[70002-work-graph-uac-dependency]]",
            resolvedTargetId: "wi:70002",
          },
        ]);
        expect(canonicalText).toContain("Graph");

        for (const alias of compatibilityAliases) {
          expect(statusJsonByAlias.get(alias)).toEqual(canonicalJson);
          expect(statusTextByAlias.get(alias)).toBe(canonicalText);
        }

        const after = await snapshotFiles(root);
        expect(after).toEqual(before);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it("prefers remote default refs over stale local branches for branch diff recovery paths", async () => {
    const root = await mkTmpRoot();
    try {
      initGitRepo(root);
      await fs.writeFile(path.join(root, "README.md"), "base\n", "utf8");
      execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "chore: base"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync("git", ["switch", "-c", "remote-main"], {
        cwd: root,
        stdio: "ignore",
      });
      await fs.writeFile(
        path.join(root, "remote-only.txt"),
        "remote\n",
        "utf8",
      );
      execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "chore: remote main"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync("git", ["switch", "-c", "sandcastle/issue-remote-main"], {
        cwd: root,
        stdio: "ignore",
      });
      await writeTask(
        root,
        "106-remote-main-diff.md",
        `id: wi-106-remote-main-diff
title: Remote Main Diff
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "feat: branch work"], {
        cwd: root,
        stdio: "ignore",
      });

      const branchDiffPaths = collectBranchDiffPaths(root);
      expect(branchDiffPaths).toContain("backlog/106-remote-main-diff.md");
      expect(branchDiffPaths).not.toContain("remote-only.txt");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("does not derive a task status worktree from the task ID or branch", async () => {
    const root = await mkTmpRoot();
    const worktreeRoot = `${root}-issue-106-worktree`;
    try {
      initGitRepo(root);
      ensureRuntimeClaimAuthority(root);
      await writeTask(
        root,
        "106-worktree-status.md",
        `id: wi-106-worktree
title: Worktree Status
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "chore: base"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync(
        "git",
        [
          "worktree",
          "add",
          "-b",
          "sandcastle/issue-106-worktree",
          worktreeRoot,
          "HEAD",
        ],
        { cwd: root, stdio: "ignore" },
      );

      const status = JSON.parse(
        runCli(root, ["work", "106-worktree", "status", "--json"]),
      );
      const normalizedWorktreeRoot = await fs.realpath(worktreeRoot);

      expect(status).toMatchObject({
        id: "wi-106-worktree",
        recovery: {
          gitState: {
            currentBranch: "main",
            currentWorktree: await fs.realpath(root),
          },
        },
      });
      expect(status.recovery.gitState.currentWorktree).not.toBe(
        normalizedWorktreeRoot,
      );
    } finally {
      try {
        execFileSync("git", ["worktree", "remove", "--force", worktreeRoot], {
          cwd: root,
          stdio: "ignore",
        });
      } catch {
        // The test may fail before the worktree is created.
      }
      await fs.rm(worktreeRoot, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("resolves task status from a registered runtime worktree using its local branch", async () => {
    const root = await mkTmpRoot();
    const worktreeRoot = `${root}-runtime-status-worktree`;
    try {
      initGitRepo(root);
      await writeTask(
        root,
        "106-runtime-worktree-status.md",
        `id: wi-106-runtime-worktree-status
title: Runtime Worktree Status
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "chore: base"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync(
        "git",
        [
          "worktree",
          "add",
          "-b",
          "sandcastle/issue-runtime-status",
          worktreeRoot,
          "HEAD",
        ],
        { cwd: root, stdio: "ignore" },
      );
      const normalizedWorktreeRoot = await fs.realpath(worktreeRoot);
      const store = openRuntimeSqliteStore({ rootDir: root });
      try {
        const acquisition = store.acquireRuntimeClaim({
          schema_version: RUNTIME_SCHEMA_VERSION,
          target_type: "task",
          target_id: "wi-106-runtime-worktree-status",
          holder: "agent@example.com",
          created_at: "2099-01-01T00:00:00.000Z",
          expires_at: "2099-01-02T00:00:00.000Z",
          metadata: {
            branch: "sandcastle/stale-runtime-metadata",
            worktree: normalizedWorktreeRoot,
          },
          entropy: "runtime-worktree-status",
        });
        if (acquisition.outcome !== "acquired") {
          throw new Error("Expected runtime claim acquisition.");
        }
        store.insertExecutionLogEntry({
          schema_version: RUNTIME_SCHEMA_VERSION,
          claim_token: acquisition.claimToken,
          target_type: "task",
          target_id: "wi-106-runtime-worktree-status",
          state: "completed",
          reason: "success",
          created_at: "2099-01-01T01:00:00.000Z",
          detail: { code: "x-runtime-completed" },
        });
      } finally {
        store.close();
      }

      const status = runCliJson<{
        recovery: {
          gitState: {
            currentBranch?: string;
            currentWorktree?: string;
            expectedBranch?: string;
            expectedWorktree?: string;
          };
        };
      }>(root, ["work", "wi-106-runtime-worktree-status", "status", "--json"]);

      expect(status.recovery.gitState).toMatchObject({
        currentBranch: "sandcastle/issue-runtime-status",
        currentWorktree: normalizedWorktreeRoot,
        expectedBranch: "sandcastle/issue-runtime-status",
        expectedWorktree: normalizedWorktreeRoot,
      });
      expect(status.recovery.gitState.expectedBranch).not.toBe(
        "sandcastle/stale-runtime-metadata",
      );
    } finally {
      try {
        execFileSync("git", ["worktree", "remove", "--force", worktreeRoot], {
          cwd: root,
          stdio: "ignore",
        });
      } catch {
        // The test may fail before the worktree is created.
      }
      await fs.rm(worktreeRoot, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("reads shared runtime claim state from a registered worktree", async () => {
    const root = await mkTmpRoot();
    const worktreeRoot = `${root}-shared-authority-worktree`;
    try {
      initGitRepo(root);
      await fs.writeFile(
        path.join(root, ".gitignore"),
        ".doc-vader/runtime/\n",
        "utf8",
      );
      await writeTask(
        root,
        "106-shared-authority.md",
        `id: wi-106-shared-authority
title: Shared Authority
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "chore: base"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync(
        "git",
        [
          "worktree",
          "add",
          "-b",
          "sandcastle/issue-106-shared-authority",
          worktreeRoot,
          "HEAD",
        ],
        { cwd: root, stdio: "ignore" },
      );

      expect(() =>
        readClaimAuthority({
          rootDir: worktreeRoot,
          callback: (store) => store.listClaims(),
        }),
      ).toThrow(
        expect.objectContaining({ code: "CLAIM_AUTHORITY_UNAVAILABLE" }),
      );
      await expect(
        fs.stat(
          path.join(worktreeRoot, ".doc-vader", "runtime", "runtime.sqlite"),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
      ensureRuntimeClaimAuthority(root);

      const created = JSON.parse(
        runCli(worktreeRoot, ["work", "wi-106-shared-authority", "claim",
          "--holder",
          "agent-worktree",
          "--json",
        ]),
      ) as { claimToken: string };
      const claimToken = created.claimToken;
      const claimStatus = JSON.parse(
        runCli(root, ["claim", "status", claimToken, "--json"]),
      ) as { claim?: { holder?: string } };
      expect(claimStatus.claim?.holder).toBe("agent-worktree");

      const status = JSON.parse(
        runCli(worktreeRoot, ["work", "wi-106-shared-authority", "status",
          "--json",
        ]),
      ) as { runtime?: { latestExecutionLog?: { claimToken?: string } } };

      expect(status.runtime?.latestExecutionLog?.claimToken).toBe(claimToken);
      await expect(
        fs.stat(
          path.join(worktreeRoot, ".doc-vader", "runtime", "runtime.sqlite"),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      try {
        execFileSync("git", ["worktree", "remove", "--force", worktreeRoot], {
          cwd: root,
          stdio: "ignore",
        });
      } catch {
        // The test may fail before the worktree is created.
      }
      await fs.rm(worktreeRoot, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("recovers from the selected runtime worktree using its local branch instead of stale metadata", async () => {
    const root = await mkTmpRoot();
    const worktreeRoot = `${root}-runtime-recovery-worktree`;
    try {
      initGitRepo(root);
      await fs.writeFile(
        path.join(root, ".gitignore"),
        ".doc-vader/runtime/\n",
        "utf8",
      );
      await writeTask(
        root,
        "106-runtime-recovery.md",
        `id: wi-106-runtime-recovery
title: Runtime Recovery
type: work-item
lifecycle: active
status: paused
status_reason: blocked
tags:
  - afk`,
      );
      execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "chore: base"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync(
        "git",
        [
          "worktree",
          "add",
          "-b",
          "sandcastle/issue-runtime-recovery",
          worktreeRoot,
          "HEAD",
        ],
        { cwd: root, stdio: "ignore" },
      );
      const normalizedWorktreeRoot = await fs.realpath(worktreeRoot);
      const store = openRuntimeSqliteStore({ rootDir: root });
      try {
        // The context claim is not task-scoped, proving authority comes only
        // from registered worktree metadata rather than task-ID inference.
        const acquisition = store.acquireRuntimeClaim({
          schema_version: RUNTIME_SCHEMA_VERSION,
          target_type: "runtime-context",
          target_id: "runtime:recovery",
          holder: "agent@example.com",
          created_at: "2026-06-15T12:00:00.000Z",
          expires_at: "2026-06-15T13:00:00.000Z",
          metadata: {
            branch: "sandcastle/stale-runtime-metadata",
            worktree: normalizedWorktreeRoot,
          },
          entropy: "runtime-recovery",
        });
        if (acquisition.outcome !== "acquired") {
          throw new Error("Expected runtime claim acquisition.");
        }
        store.insertExecutionLogEntry({
          schema_version: RUNTIME_SCHEMA_VERSION,
          claim_token: acquisition.claimToken,
          target_type: "task",
          target_id: "wi-106-runtime-recovery",
          state: "halted",
          reason: "blocked",
          created_at: "2026-06-15T12:01:00.000Z",
          detail: { code: "x-runtime-task-blocked" },
        });
      } finally {
        store.close();
      }

      expect(() =>
        runCli(root, ["work", "wi-106-runtime-recovery", "recover",
          "--branch",
          "sandcastle/explicit-override",
          "--json",
        ]),
      ).toThrow(/TASK_RECOVERY_RESUME_BLOCKED/);

      const recovered = runCliJson<{
        executionLogEntry: { state: string; reason: string };
        transition: { filePath: string };
      }>(worktreeRoot, [
        "work",
        "wi-106-runtime-recovery",
        "recover",
        "--json",
      ]);

      expect(recovered).toMatchObject({
        executionLogEntry: { state: "completed", reason: "success" },
        transition: {
          filePath: path.join(
            normalizedWorktreeRoot,
            "backlog/106-runtime-recovery.md",
          ),
        },
      });

      const rootView = runCliJson<{
        runtime?: { latestExecutionLog?: { state?: string; reason?: string } };
      }>(root, ["work", "wi-106-runtime-recovery", "status", "--json"]);
      expect(rootView.runtime?.latestExecutionLog).toMatchObject({
        state: "completed",
        reason: "success",
      });
    } finally {
      try {
        execFileSync("git", ["worktree", "remove", "--force", worktreeRoot], {
          cwd: root,
          stdio: "ignore",
        });
      } catch {
        // The test may fail before the worktree is created.
      }
      await fs.rm(worktreeRoot, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("recovers a ready runtime disagreement from an unambiguous sandcastle worktree", async () => {
    const root = await mkTmpRoot();
    const worktreeRoot = `${root}-issue-106-recover-worktree`;
    try {
      initGitRepo(root);
      await fs.writeFile(
        path.join(root, ".gitignore"),
        ".doc-vader/runtime/\n",
        "utf8",
      );
      await writeTask(
        root,
        "106-recover-worktree.md",
        `id: wi-106-recover-worktree
title: Recover Worktree
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "chore: base"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync(
        "git",
        [
          "worktree",
          "add",
          "-b",
          "sandcastle/issue-106-recover-worktree",
          worktreeRoot,
          "HEAD",
        ],
        { cwd: root, stdio: "ignore" },
      );
      await fs.writeFile(
        path.join(worktreeRoot, "backlog/106-recover-worktree.md"),
        `---
id: wi-106-recover-worktree
title: Recover Worktree
type: work-item
lifecycle: active
status: ready
tags:
  - afk
---

## Acceptance criteria

- [x] Do the thing
`,
        "utf8",
      );
      recordRuntimeExecutionLog(root, {
        claim_token: "claim-wi-106-recover-worktree",
        target_type: "task",
        target_id: "wi-106-recover-worktree",
        state: "running",
        reason: "started",
        created_at: "2026-06-15T12:00:00.000Z",
        detail: {
          code: "x-runtime-task-started",
          message: "Interrupted after checklist update.",
        },
      });

      const recovered = JSON.parse(
        runCli(root, ["work", "wi-106-recover-worktree", "recover",
          "--worktree",
          worktreeRoot,
          "--json",
        ]),
      ) as {
        claim: {
          metadata?: {
            worktree?: string;
          };
        };
        executionLogEntry: {
          state: string;
          reason: string;
        };
        transition: {
          filePath: string;
        };
      };

      expect(recovered).toMatchObject({
        executionLogEntry: {
          state: "completed",
          reason: "success",
        },
        transition: {
          filePath: path.join(
            await fs.realpath(worktreeRoot),
            "backlog/106-recover-worktree.md",
          ),
        },
      });
      expect(recovered.claim.metadata?.worktree).toBeUndefined();
    } finally {
      try {
        execFileSync("git", ["worktree", "remove", "--force", worktreeRoot], {
          cwd: root,
          stdio: "ignore",
        });
      } catch {
        // The test may fail before the worktree is created.
      }
      await fs.rm(worktreeRoot, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it(
    "safely recovers a stale missing-claim execution before creating a task claim",
    { timeout: 30_000 },
    async () => {
      const root = await mkTmpRoot();
      try {
        initGitRepo(root);
        await fs.writeFile(
          path.join(root, ".gitignore"),
          ".doc-vader/runtime/\n",
          "utf8",
        );
        await writeTask(
          root,
          "106-claim-recoverable.md",
          `id: wi-106-claim-recoverable
title: Claim Recoverable
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
        );
        execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
        execFileSync("git", ["commit", "-m", "chore: base"], {
          cwd: root,
          stdio: "ignore",
        });
        execFileSync(
          "git",
          ["switch", "-c", "sandcastle/issue-106-claim-recoverable"],
          {
            cwd: root,
            stdio: "ignore",
          },
        );
        await fs.writeFile(
          path.join(root, "backlog/106-claim-recoverable.md"),
          `---
id: wi-106-claim-recoverable
title: Claim Recoverable
type: work-item
lifecycle: active
status: ready
tags:
  - afk
---

## Acceptance criteria

- [x] Do the thing
`,
          "utf8",
        );
        recordRuntimeExecutionLog(root, {
          claim_token: "claim-wi-106-claim-recoverable",
          target_type: "task",
          target_id: "wi-106-claim-recoverable",
          state: "running",
          reason: "started",
          created_at: "2026-06-15T12:00:00.000Z",
          detail: {
            code: "x-runtime-task-started",
            message: "Interrupted after checklist update.",
          },
        });

        const claimed = JSON.parse(
          runCli(root, ["work", "wi-106-claim-recoverable", "claim",
            "--holder",
            "agent-a",
            "--branch",
            "sandcastle/issue-106-claim-recoverable",
            "--json",
          ]),
        ) as {
          outcome: string;
          executionLogEntry: {
            state: string;
            reason: string;
          };
        };

        expect(claimed).toMatchObject({
          outcome: "acquired",
          executionLogEntry: {
            state: "running",
            reason: "started",
          },
        });

        const status = JSON.parse(
          runCli(root, ["work", "wi-106-claim-recoverable", "status",
            "--json",
          ]),
        );
        expect(status.runtime.latestExecutionLog).toMatchObject({
          state: "running",
          reason: "started",
          claimState: "active",
        });
        expect(status.recovery.state).toBe("blocked");
        expect(status.recovery.blockedReasons).toContain("claim-active");
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it("rejects task claim creation when the latest execution log is not ready-permitting", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "106-runtime-blocked-claim.md",
        `id: wi-106-claim
title: Runtime Blocked Claim
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      recordRuntimeExecutionLog(root, {
        claim_token: "claim-wi-106-claim",
        target_type: "task",
        target_id: "wi-106-claim",
        state: "halted",
        reason: "blocked",
        created_at: "2026-06-15T12:00:00.000Z",
        detail: {
          code: "x-runtime-task-blocked",
          message: "Blocked by runtime execution.",
        },
      });

      let output = "";
      try {
        runCli(root, ["work", "106-claim", "claim",
          "--holder",
          "agent-a",
          "--json",
        ]);
      } catch (error) {
        const captured = error as { stdout?: unknown; stderr?: unknown };
        output = [
          String(captured.stdout ?? ""),
          String(captured.stderr ?? ""),
        ].join("\n");
      }

      expect(output).toContain("TASK_NOT_CLAIMABLE");
      expect(output).toContain("execution-not-ready");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it(
    "requires force when --worktree is omitted and runtime metadata has no branch or worktree lineage",
    { timeout: 30_000 },
    async () => {
      const root = await mkTmpRoot();
      try {
        initGitRepo(root);
        await fs.writeFile(
          path.join(root, ".gitignore"),
          ".doc-vader/runtime/\n",
          "utf8",
        );
        execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
        execFileSync("git", ["commit", "-m", "chore: base"], {
          cwd: root,
          stdio: "ignore",
        });
        execFileSync("git", ["switch", "-c", "sandcastle/issue-106-recover"], {
          cwd: root,
          stdio: "ignore",
        });
        await writeTask(
          root,
          "106-runtime-recover-claim.md",
          `id: wi-106-recover
title: Runtime Recover Claim
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
        );
        execFileSync("git", ["add", "backlog/106-runtime-recover-claim.md"], {
          cwd: root,
          stdio: "ignore",
        });
        execFileSync("git", ["commit", "-m", "feat: task"], {
          cwd: root,
          stdio: "ignore",
        });
        recordRuntimeExecutionLog(root, {
          claim_token: "claim-wi-106-recover",
          target_type: "task",
          target_id: "wi-106-recover",
          state: "failed",
          reason: "error",
          created_at: "2026-06-15T12:00:00.000Z",
          detail: {
            code: "x-runtime-claim-failed",
            message: "Execution failed but left no live claim or locks.",
          },
        });

        const task = await loadTaskModel("wi-106-recover", { rootDir: root });
        expect(task.runtime).toMatchObject({
          markdownReady: true,
          executionReady: false,
          ready: false,
          sourceDisagreement: true,
          latestExecutionLog: {
            claimToken: "claim-wi-106-recover",
            state: "failed",
            reason: "error",
            readyPermitting: false,
          },
        });
        expect(() =>
          runCli(root, ["work", "wi-106-recover", "recover", "--json"]),
        ).toThrow(/TASK_RECOVERY_FORCE_REQUIRED/);

        const dryRun = JSON.parse(
          runCli(root, ["work", "wi-106-recover", "recover",
            "--branch",
            "sandcastle/issue-106-recover",
            "--dry-run",
            "--json",
          ]),
        ) as {
          dryRun: boolean;
          plannedInitialLockPaths: string[];
          transition: {
            dryRun: boolean;
            frontmatter: {
              status: string;
              status_reason: string;
            };
          };
        };
        expect(dryRun).toMatchObject({
          dryRun: true,
          plannedInitialLockPaths: ["backlog/106-runtime-recover-claim.md"],
          transition: {
            dryRun: true,
            frontmatter: {
              status: "ready",
              status_reason: "recoverable",
            },
          },
        });
        const stillBlocked = JSON.parse(
          runCli(root, ["work", "ready", "--json"]),
        ) as {
          candidates: Array<{ id: string }>;
        };
        expect(
          stillBlocked.candidates.map((candidate) => candidate.id),
        ).not.toContain("wi-106-recover");

        const recovered = JSON.parse(
          runCli(root, ["work", "wi-106-recover", "recover",
            "--branch",
            "sandcastle/issue-106-recover",
            "--json",
          ]),
        ) as {
          warnings?: string[];
          executionLogEntry: {
            state: string;
            reason: string;
          };
          transition: {
            frontmatter: {
              status: string;
              status_reason: string;
            };
          };
        };
        expect(recovered).toMatchObject({
          executionLogEntry: {
            state: "completed",
            reason: "success",
          },
          transition: {
            frontmatter: {
              status: "ready",
              status_reason: "recoverable",
            },
          },
        });
        expect(recovered.warnings).toBeUndefined();

        const ready = JSON.parse(runCli(root, ["work", "ready", "--json"])) as {
          candidates: Array<{ id: string }>;
        };
        expect(ready.candidates.map((candidate) => candidate.id)).toContain(
          "wi-106-recover",
        );
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it("does not recover ready runtime disagreement while live claim state remains", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "106-runtime-cancelled-active.md",
        `id: wi-106-cancelled-active
title: Runtime Cancelled Active
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      const claimToken = "claim-wi-106-cancelled-active";
      const store = openRuntimeSqliteStore({ rootDir: root });
      try {
        store.insertClaim({
          schema_version: RUNTIME_SCHEMA_VERSION,
          claim_token: claimToken,
          target_type: "task",
          target_id: "wi-106-cancelled-active",
          holder: "agent-a",
          created_at: "2099-06-15T12:00:00.000Z",
          expires_at: "2099-06-15T13:00:00.000Z",
        });
        store.insertLock({
          schema_version: RUNTIME_SCHEMA_VERSION,
          key: "7e3f9a0b1c2d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789ab",
          path: "backlog/106-runtime-cancelled-active.md",
          claim_token: claimToken,
          target_type: "task",
          target_id: "wi-106-cancelled-active",
          created_at: "2099-06-15T12:01:00.000Z",
        });
      } finally {
        store.close();
      }
      recordRuntimeExecutionLog(root, {
        claim_token: claimToken,
        target_type: "task",
        target_id: "wi-106-cancelled-active",
        state: "halted",
        reason: "cancelled",
        created_at: "2099-06-15T12:02:00.000Z",
        detail: {
          code: "x-runtime-claim-halted",
          message: "Cancelled while claim state remained live.",
        },
      });

      const task = await loadTaskModel("wi-106-cancelled-active", {
        rootDir: root,
      });
      expect(task.runtime?.latestExecutionLog).toMatchObject({
        claimToken,
        claimState: "active",
        lockCount: 1,
        state: "halted",
        reason: "cancelled",
        readyPermitting: false,
      });
      expect(() =>
        runCli(root, ["work", "wi-106-cancelled-active", "recover", "--json"]),
      ).toThrow(/TASK_RECOVERY_GIT_REPOSITORY_UNAVAILABLE/);

      const readyText = runCli(root, ["work", "ready"]);
      expect(readyText).not.toContain("wi-106-cancelled-active");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("uses the latest execution log when composing task readiness", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "107-runtime-latest-log.md",
        `id: wi-107
title: Runtime Latest Log
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      recordRuntimeExecutionLog(root, {
        claim_token: "claim-wi-107-older",
        target_type: "task",
        target_id: "wi-107",
        state: "halted",
        reason: "blocked",
        created_at: "2026-06-15T12:00:00.000Z",
        detail: {
          code: "x-runtime-task-blocked",
          message: "Older halted attempt.",
        },
      });
      recordRuntimeExecutionLog(root, {
        claim_token: "claim-wi-107-newer",
        target_type: "task",
        target_id: "wi-107",
        state: "completed",
        reason: "success",
        created_at: "2026-06-15T12:05:00.000Z",
        detail: {
          code: "x-runtime-task-completed",
          message: "Latest execution finished successfully.",
        },
      });

      const task = await loadTaskModel("wi-107", { rootDir: root });
      expect(task.runtime).toMatchObject({
        markdownReady: true,
        executionReady: true,
        ready: true,
        sourceDisagreement: false,
        latestExecutionLog: {
          claimToken: "claim-wi-107-newer",
          state: "completed",
          reason: "success",
          readyPermitting: true,
        },
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("fails claim creation when the latest execution log is not ready-permitting", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "107-runtime-blocked.md",
        `id: wi-107
title: Runtime Blocked
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      recordRuntimeExecutionLog(root, {
        claim_token: "claim-wi-107",
        target_type: "task",
        target_id: "wi-107",
        state: "halted",
        reason: "blocked",
        created_at: "2026-06-15T12:00:00.000Z",
        detail: {
          code: "x-runtime-task-blocked",
          message: "Blocked by runtime execution.",
        },
      });

      expect(() =>
        runCli(root, ["work", "107", "claim", "--holder", "agent-a", "--json"]),
      ).toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("ignores markdown relationship sections when deriving ready/status graph data", async () => {
    const root = await mkTmpRoot();
    try {
      ensureRuntimeClaimAuthority(root);
      await writeTask(
        root,
        "300-markdown-relationship.md",
        `id: wi-300
title: Markdown Relationship Is Context Only
type: work-item
lifecycle: active
status: ready
links:
  depends_on: []
tags:
  - afk`,
        "## Relationships\n\n- `depends_on`: None\n- `belongs_to`: `[[missing-project]]`\n\n## Acceptance criteria\n\n- [ ] Do the thing\n",
      );

      const ready = await selectReadyTasks({ rootDir: root });
      expect(ready.candidates.map((candidate) => candidate.id)).toEqual([
        "wi-300",
      ]);
      expect(ready.exclusions).toEqual([]);

      const status = runCliJson<{
        runtime: { markdownReady: boolean; ready: boolean };
        graph?: {
          relationships: unknown[];
          diagnostics: { projection: unknown[] };
        };
      }>(root, ["work", "300", "status", "--json"]);
      expect(status.runtime).toMatchObject({
        markdownReady: true,
        ready: true,
      });
      expect(status.graph?.relationships ?? []).toEqual([]);
      expect(status.graph?.diagnostics.projection ?? []).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("initializes claim authority through the claim package for fresh work ready selection", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "199-fresh-ready.md",
        `id: wi-199
 title: Fresh Ready
 type: work-item
 lifecycle: active
 status: ready
 tags:
   - afk`,
      );
      expect(() => runCliJson(root, ["work", "ready", "--json"])).not.toThrow();
      await expect(
        fs.stat(path.join(root, ".doc-vader", "runtime", "runtime.sqlite")),
      ).resolves.toBeDefined();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects removed publisher selection command routes", async () => {
    const root = await mkTmpRoot();
    try {
      for (const args of [
        ["work", "capabilities", "--json"],
        ["work", "select", "--request", "-", "--json"],
      ]) {
        expect(() => runCli(root, args)).toThrow();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it(
    "selects ready tasks and reports structured deterministic exclusions",
    { timeout: 15_000 },
    async () => {
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
          "213-completed.md",
          `id: wi-213
title: Completed
type: work-item
lifecycle: active
status: completed
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
        await writeTask(
          root,
          "211-runtime-blocked.md",
          `id: wi-211
title: Runtime Blocked
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
        );
        await writeTask(
          root,
          "212-runtime-cancelled.md",
          `id: wi-212
title: Runtime Cancelled
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
        );
        await claimTask("wi-203", {
          rootDir: root,
          claimStorePath: claimStorePath(root),
          holder: "agent-a",
        });
        recordRuntimeExecutionLog(root, {
          claim_token: "claim-wi-211",
          target_type: "task",
          target_id: "wi-211",
          state: "halted",
          reason: "blocked",
          created_at: "2026-06-15T12:00:00.000Z",
          detail: {
            code: "x-runtime-task-blocked",
            message: "Blocked by runtime execution.",
          },
        });
        recordRuntimeExecutionLog(root, {
          claim_token: "claim-wi-212",
          target_type: "task",
          target_id: "wi-212",
          state: "halted",
          reason: "cancelled",
          created_at: "2026-06-15T12:05:00.000Z",
          detail: {
            code: "x-runtime-claim-halted",
            message: "Cancelled during troubleshooting.",
          },
        });

        const report = await selectReadyTasks({
          rootDir: root,
          claimStorePath: claimStorePath(root),
        });

        expect(report.candidates.map((task) => task.id)).toEqual(["wi-200", "wi-204"]);
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
        const exclusionCodes = report.exclusions.map((entry) => ({
          id: entry.id,
          codes: entry.reasons.map((reason) => reason.code),
        }));
        expect(exclusionCodes).toEqual([
          { id: "wi-201", codes: ["hitl"] },
          { id: "wi-202", codes: ["dependency_blocked"] },
          { id: "wi-203", codes: ["task_claim_active", "execution_not_ready"] },
          { id: "wi-205", codes: ["invalid"] },
          { id: "wi-206", codes: ["closed", "not_ready", "not_active"] },
          { id: "wi-207", codes: ["blocked", "not_ready"] },
          { id: "wi-209", codes: ["closed", "not_ready", "not_active"] },
          { id: "wi-210", codes: ["dependency_blocked", "not_ready"] },
          { id: "wi-211", codes: ["execution_not_ready"] },
          { id: "wi-212", codes: ["execution_not_ready"] },
          { id: "wi-213", codes: ["closed", "not_ready"] },
          { id: "wi-208", codes: ["archived"] },
        ]);
        const porcelain = runCli(root, ["work", "ready", "--porcelain"]);
        expect(porcelain.trim()).toBe(
          ["wi-200\tbacklog/200-ready.md\tReady", "wi-204\tbacklog/204-missing-classification.md\tMissing Classification"].join("\n"),
        );
        const text = runCli(root, ["work", "ready"]);
        expect(text).toContain("Ready work candidates");
        expect(text).toContain("Candidates: 2");
        expect(text).toContain("Recoverable with --force: 2 (wi-211, wi-212)");
        expect(text).toContain(
          "Branch lineage or task-local dirty state is uncertain",
        );
        expect(text).toContain("- wi-200 | Ready | backlog/200-ready.md");
        expect(text).not.toContain(
          "- wi-203 | Dependency | backlog/203-dependency.md",
        );
        expect(text).not.toContain("Excluded");
        expect(text).not.toContain("HITL tasks are not AFK-ready candidates.");
        const json = JSON.parse(runCli(root, ["work", "ready", "--json"]));
        expect(json.schemaVersion).toBe("task-ready/v1");
        expect(json.candidates).toHaveLength(2);
        expect(json.exclusions).toHaveLength(12);
        expect(json.candidates[0]).toMatchObject({
          id: "wi-200",
          runtime: {
            markdownReady: true,
            executionReady: true,
            ready: true,
            sourceDisagreement: false,
          },
        });
        expect(
          json.exclusions.find(
            (entry: { id?: string }) => entry.id === "wi-211",
          ),
        ).toMatchObject({
          id: "wi-211",
          runtime: {
            markdownReady: true,
            executionReady: false,
            ready: false,
            sourceDisagreement: true,
            latestExecutionLog: {
              state: "halted",
              reason: "blocked",
              readyPermitting: false,
            },
          },
        });
        const listText = runCli(root, ["work", "list"]);
        expect(listText).toContain("wi-200 | ready | Ready");
        expect(listText).toContain("wi-211 | ready | Runtime Blocked");
        expect(listText).toContain("wi-212 | ready | Runtime Cancelled");
        expect(listText).not.toContain("wi-206");
        const candidatesOnly = JSON.parse(
          runCli(root, ["work", "ready", "--json", "--candidates-only"]),
        );
        expect(candidatesOnly.schemaVersion).toBe("task-ready/v1");
        expect(candidatesOnly.candidates).toHaveLength(2);
        expect(candidatesOnly.exclusions).toBeUndefined();
        expect(candidatesOnly.candidates[0]).toMatchObject({
          id: "wi-200",
          runtime: {
            markdownReady: true,
            executionReady: true,
            ready: true,
            sourceDisagreement: false,
          },
        });
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it("only returns ready candidates that can be claimed in the same context", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "200-claimable-ready.md",
        `id: wi-200
title: Claimable Ready
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      await writeTask(
        root,
        "201-runtime-blocked.md",
        `id: wi-201
title: Runtime Blocked
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      recordRuntimeExecutionLog(root, {
        claim_token: "claim-wi-201",
        target_type: "task",
        target_id: "wi-201",
        state: "halted",
        reason: "blocked",
        created_at: "2026-06-15T12:00:00.000Z",
        detail: {
          code: "x-runtime-task-blocked",
          message: "Blocked by runtime execution.",
        },
      });

      const ready = JSON.parse(
        runCli(root, ["work", "ready", "--json", "--candidates-only"]),
      ) as {
        candidates: Array<{ id: string }>;
      };

      expect(ready.candidates.map((candidate) => candidate.id)).toEqual([
        "wi-200",
      ]);

      const claimed = JSON.parse(
        runCli(root, [
          "work", ready.candidates[0]!.id, "claim",
          "--holder", "agent-a", "--json",
        ]),
      ) as {
        outcome: string;
        executionLogEntry: {
          state: string;
          reason: string;
        };
      };

      expect(claimed).toMatchObject({
        outcome: "acquired",
        executionLogEntry: {
          state: "running",
          reason: "started",
        },
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("uses the shared repository authority for ready and claim", async () => {
    const root = await mkTmpRoot();
    const worktreeRoot = `${root}-issue-202-worktree`;
    try {
      initGitRepo(root);
      await fs.writeFile(
        path.join(root, ".gitignore"),
        ".doc-vader/runtime/\n",
        "utf8",
      );
      await writeTask(
        root,
        "202-worktree-authority.md",
        `id: wi-202
title: Worktree Authority
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "chore: base"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync(
        "git",
        ["worktree", "add", "-b", "sandcastle/issue-202", worktreeRoot, "HEAD"],
        { cwd: root, stdio: "ignore" },
      );

      const store = openRuntimeSqliteStore({ rootDir: root });
      try {
        const now = new Date("2099-06-15T12:00:00.000Z");
        const claim = store.acquireRuntimeClaim({
          schema_version: RUNTIME_SCHEMA_VERSION,
          target_type: "task",
          target_id: "wi-202",
          holder: "sandcastle:test",
          created_at: now.toISOString(),
          expires_at: new Date(now.getTime() + 60 * 60_000).toISOString(),
          metadata: {
            branch: "sandcastle/issue-202",
          },
          entropy: randomUUID(),
        });
        expect(claim.outcome).toBe("acquired");
      } finally {
        store.close();
      }

      const ready = JSON.parse(
        runCli(root, ["work", "ready", "--json", "--candidates-only"]),
      ) as {
        candidates: Array<{ id: string }>;
      };
      expect(ready.candidates.map((candidate) => candidate.id)).not.toContain(
        "wi-202",
      );

      let claimError: unknown;
      try {
        runCli(root, ["work", "wi-202", "claim", "--json"]);
      } catch (error) {
        claimError = error;
      }
      expect(claimError).toBeDefined();
      const processError = claimError as {
        message?: string;
        stderr?: Buffer | string;
        stdout?: Buffer | string;
      };
      expect(
        [processError.stdout, processError.stderr, processError.message]
          .map((value) => value?.toString() ?? "")
          .join("\n"),
      ).toContain("TASK_NOT_CLAIMABLE");
    } finally {
      try {
        execFileSync("git", ["worktree", "remove", "--force", worktreeRoot], {
          cwd: root,
          stdio: "ignore",
        });
      } catch {
        // The test may fail before the worktree is created.
      }
      await fs.rm(worktreeRoot, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("does not derive an issue worktree for stale ready root work", async () => {
    const root = await mkTmpRoot();
    const worktreeRoot = `${root}-issue-214-worktree`;
    try {
      initGitRepo(root);
      ensureRuntimeClaimAuthority(root);
      await fs.writeFile(
        path.join(root, ".gitignore"),
        ".doc-vader/runtime/\n",
        "utf8",
      );
      await writeTask(
        root,
        "214-stale-ready.md",
        `id: wi-214
title: Stale Ready
type: work-item
lifecycle: active
status: ready
status_reason: auto
tags:
  - afk`,
      );
      execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "chore: base"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync(
        "git",
        ["worktree", "add", "-b", "sandcastle/issue-214", worktreeRoot, "HEAD"],
        { cwd: root, stdio: "ignore" },
      );
      await writeTask(
        worktreeRoot,
        "214-stale-ready.md",
        `id: wi-214
title: Stale Ready
type: work-item
lifecycle: active
status: completed
status_reason: completed
actual: 1
completed_date: 2026-07-10
links:
  evidence:
    - '[[backlog/audit/auditing-backlog-report.json]]'
tags:
  - afk`,
      );
      const ready = JSON.parse(runCli(root, ["work", "ready", "--json"])) as {
        candidates: Array<{ id: string }>;
        exclusions: Array<{ id: string; reasons: Array<{ code: string }> }>;
      };

      expect(ready.candidates.map((candidate) => candidate.id)).toContain(
        "wi-214",
      );
      expect(
        ready.exclusions.find((exclusion) => exclusion.id === "wi-214"),
      ).toBeUndefined();
    } finally {
      try {
        execFileSync("git", ["worktree", "remove", "--force", worktreeRoot], {
          cwd: root,
          stdio: "ignore",
        });
      } catch {
        // The test may fail before the worktree is created.
      }
      await fs.rm(worktreeRoot, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);

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

  it("keeps expired claims out of ready selection inputs", async () => {
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

      const report = await selectReadyTasks({
        rootDir: root,
        claimStorePath: claimStorePath(root),
      });

      expect(report.candidates.map((entry) => entry.id)).toEqual(["wi-204"]);
      expect(
        report.exclusions.map((entry) => ({
          id: entry.id,
          codes: entry.reasons.map((reason) => reason.code),
        })),
      ).toEqual([{ id: "wi-205", codes: ["dependency_state_unknown"] }]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("uses frontmatter links projected as graph depends_on relationships during ready selection", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "214-relationship-dependency.md",
        `id: wi-214
title: Relationship Dependency
type: work-item
lifecycle: active
status: ready
tags:
  - afk
links:
  depends_on:
    - '[[wi-215]]'`,
        `## Goal

Prove graph-backed ready selection uses projected dependency edges.
`,
      );
      await writeTask(
        root,
        "215-blocking-dependency.md",
        `id: wi-215
title: Blocking Dependency
type: work-item
lifecycle: active
status: in-progress
tags:
  - afk`,
      );

      const report = await selectReadyTasks({
        rootDir: root,
        claimStorePath: claimStorePath(root),
      });

      expect(report.candidates).toEqual([]);
      expect(report.exclusions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "wi-214",
            reasons: expect.arrayContaining([
              expect.objectContaining({ code: "dependency_blocked" }),
            ]),
            findings: expect.arrayContaining([
              expect.objectContaining({
                reasonCode: "dependency_unsatisfied",
                subjectId: "wi-214",
                evidence: expect.arrayContaining([
                  expect.objectContaining({
                    ref: "wi-215",
                  }),
                ]),
              }),
            ]),
          }),
        ]),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("deduplicates code-formatted authored dependency refs against projected dependencies", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "216-shared-dependency.md",
        `id: wi-216
title: Shared Dependency
type: work-item
lifecycle: active
status: completed
status_reason: completed
completed_date: '2026-06-30'
tags:
  - afk`,
      );
      await writeTask(
        root,
        "217-short-form-dependent.md",
        `id: wi-217
title: Short Form Dependent
type: work-item
lifecycle: active
status: ready
tags:
  - afk
links:
  depends_on:
    - '[[216-shared-dependency]]'`,
        `## Relationships

- \`depends_on\`: \`[[216-shared-dependency]]\`
`,
      );
      await writeTask(
        root,
        "218-path-form-dependent.md",
        `id: wi-218
title: Path Form Dependent
type: work-item
lifecycle: active
status: ready
tags:
  - afk
links:
  depends_on:
    - '[[../backlog/216-shared-dependency.md]]'`,
        `## Relationships

- \`depends_on\`: \`[[../backlog/216-shared-dependency.md]]\`
`,
      );

      const report = await selectReadyTasks({
        rootDir: root,
        claimStorePath: claimStorePath(root),
      });

      expect(report.candidates.map((entry) => entry.id)).toEqual([
        "wi-217",
        "wi-218",
      ]);
      expect(
        report.candidates.map((candidate) => ({
          id: candidate.id,
          dependencies: candidate.dependencies,
        })),
      ).toEqual([
        {
          id: "wi-217",
          dependencies: [
            expect.objectContaining({
              id: "wi-216",
              satisfied: true,
              stateKnown: true,
            }),
          ],
        },
        {
          id: "wi-218",
          dependencies: [
            expect.objectContaining({
              id: "wi-216",
              satisfied: true,
              stateKnown: true,
            }),
          ],
        },
      ]);
      expect(
        report.exclusions.filter((entry) =>
          ["wi-217", "wi-218"].includes(entry.id ?? ""),
        ),
      ).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("projects derived readiness findings separately from authored dependencies", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "206-dependency-blocked.md",
        `id: wi-206
title: Dependency Blocked
type: work-item
lifecycle: active
status: ready
tags:
  - afk
links:
  depends_on:
    - '[[wi-207]]'`,
      );
      await writeTask(
        root,
        "207-incomplete-dependency.md",
        `id: wi-207
title: Incomplete Dependency
type: work-item
lifecycle: active
status: in-progress
tags:
  - afk`,
      );
      await writeTask(
        root,
        "208-runtime-claimed.md",
        `id: wi-208
title: Runtime Claimed
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      await writeTask(
        root,
        "209-missing-evidence.md",
        `id: wi-209
title: Missing Evidence
type: work-item
lifecycle: inactive
status: completed
status_reason: completed
tags:
  - afk`,
      );

      acquireRuntimeTaskClaim(root, "wi-208", [], "agent-runtime");

      const report = await selectReadyTasks({
        rootDir: root,
        claimStorePath: claimStorePath(root),
      });

      expect(report.candidates).toEqual([]);
      expect(report.exclusions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "wi-206",
            reasons: expect.arrayContaining([
              expect.objectContaining({ code: "dependency_blocked" }),
            ]),
            findings: expect.arrayContaining([
              expect.objectContaining({
                reasonCode: "dependency_unsatisfied",
                subjectId: "wi-206",
                severity: "error",
                evidence: expect.arrayContaining([
                  expect.objectContaining({
                    ref: "wi-207",
                  }),
                ]),
              }),
            ]),
          }),
          expect.objectContaining({
            id: "wi-208",
            reasons: expect.arrayContaining([
              expect.objectContaining({ code: "task_claim_active" }),
            ]),
            findings: expect.arrayContaining([
              expect.objectContaining({
                reasonCode: "runtime_claim_active",
                subjectId: "wi-208",
                severity: "error",
                evidence: expect.arrayContaining([
                  expect.objectContaining({
                    ref: "claim:wi-208",
                  }),
                ]),
              }),
            ]),
          }),
          expect.objectContaining({
            id: "wi-209",
            findings: expect.arrayContaining([
              expect.objectContaining({
                reasonCode: "governance_missing_evidence",
                subjectId: "wi-209",
                severity: "error",
              }),
            ]),
          }),
        ]),
      );
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
      acquireRuntimeTaskClaim(root, "wi-205", [
        path.join(root, "backlog", "205-record.md"),
        path.join(root, "backlog", "records", "record-wi-205-evidence.md"),
      ]);

      const result = await recordTaskEvidence({
        rootDir: root,
        claimStorePath: claimStorePath(root),
        claimId: claim.claimId,
        type: "test-result",
        payload: validateTaskRecordPayload({
          id: "record:wi-205-evidence",
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

  it("preflights task records against absolute registered-worktree records roots", async () => {
    const root = await mkTmpRoot();
    const worktree = `${root}-record-worktree`;
    try {
      await writeTask(
        root,
        "205-worktree-record.md",
        `id: wi-205-worktree-record
title: Worktree Record
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      initGitRepo(root);
      execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "record fixture"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync(
        "git",
        ["worktree", "add", "-b", "record-worktree", worktree],
        { cwd: root, stdio: "ignore" },
      );
      const consumerConfig = path.join(root, "worktree-records-consumer.json");
      await fs.writeFile(
        consumerConfig,
        JSON.stringify({
          roots: {
            backlog: "backlog",
            active: "backlog",
            archive: "backlog/archive",
            records: path.join(worktree, "backlog", "records"),
            audit: "backlog/audit",
          },
        }),
        "utf8",
      );

      const claim = await claimTask("wi-205-worktree-record", {
        rootDir: root,
        claimStorePath: claimStorePath(root),
        holder: "agent-a",
      });
      const recordPath = path.join(
        worktree,
        "backlog",
        "records",
        "record-wi-205-worktree-evidence.md",
      );
      acquireRuntimeTaskClaim(root, "wi-205-worktree-record", [recordPath]);

      const result = await recordTaskEvidence({
        rootDir: root,
        claimStorePath: claimStorePath(root),
        consumerConfig,
        claimId: claim.claimId,
        type: "test-result",
        payload: validateTaskRecordPayload({
          id: "record:wi-205-worktree-evidence",
          summary: "Registered worktree record",
          observation:
            "Record preflight preserves its absolute registered worktree path.",
          outcome: "pass",
        }),
      });

      expect(result).toMatchObject({
        taskId: "wi-205-worktree-record",
        record: { filePath: recordPath },
      });
      await expect(fs.readFile(recordPath, "utf8")).resolves.toContain(
        "Record preflight preserves its absolute registered worktree path.",
      );
    } finally {
      try {
        execFileSync("git", ["worktree", "remove", "--force", worktree], {
          cwd: root,
          stdio: "ignore",
        });
      } catch {
        // The worktree may not have been created if fixture setup failed.
      }
      await fs.rm(worktree, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("does not create runtime sqlite while checking optional runtime subjects", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "205-record-no-runtime.md",
        `id: wi-205-no-runtime
title: Record Without Runtime
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      const claim = { claimId: "claim-no-runtime" };

      await expect(
        recordTaskEvidence({
          rootDir: root,
          claimStorePath: claimStorePath(root),
          claimId: claim.claimId,
          type: "test-result",
          dryRun: true,
          payload: validateTaskRecordPayload({
            id: "record:wi-205-no-runtime-evidence",
            summary: "Task validation passed",
            observation: "No runtime DB should be initialized.",
            outcome: "pass",
          }),
        }),
      ).rejects.toMatchObject({ code: "CLAIM_AUTHORITY_UNAVAILABLE" });
      await expect(
        fs.stat(path.join(root, ".doc-vader", "runtime", "runtime.sqlite")),
      ).rejects.toMatchObject({ code: "ENOENT" });
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
      const claim = await claimTask("wi-206", {
        rootDir: root,
        claimStorePath: claimStorePath(root),
        holder: "agent-a",
      });
      acquireRuntimeTaskClaim(root, "wi-206", [
        path.join(root, "backlog", "206-record-cli.md"),
        path.join(root, "backlog", "records", "record-wi-206-file.md"),
      ]);
      const payloadPath = path.join(root, "payload.json");
      await fs.writeFile(
        payloadPath,
        JSON.stringify({
          id: "record:wi-206-file",
          summary: "File payload",
          observation: "File payload recorded",
          outcome: "pass",
        }),
      );
      const fileResult = JSON.parse(
        runCli(root, [
          "work", "wi-206", "record", "--claim", claim.claimId,
          "--type", "test-result", "--payload", payloadPath, "--json",
        ]),
      );
      expect(fileResult.evidenceLink).toBe("[[record-wi-206-file]]");
      await releaseClaim(claim.claimId, {
        rootDir: root,
        claimStorePath: claimStorePath(root),
      });
      const secondClaim = await claimTask("wi-206", {
        rootDir: root,
        claimStorePath: claimStorePath(root),
        holder: "agent-b",
      });
      acquireRuntimeTaskClaim(
        root,
        "wi-206",
        [
          path.join(root, "backlog", "206-record-cli.md"),
          path.join(root, "backlog", "records", "record-wi-206-stdin.md"),
        ],
        "agent-b",
      );
      const stdinResult = JSON.parse(
        runCli(
          root,
          [
            "work", "wi-206", "record", "--claim", secondClaim.claimId,
            "--type", "test-result", "--payload", "-", "--json",
          ],
          JSON.stringify({
            id: "record:wi-206-stdin",
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

  it("creates generic records from payload files without claim context", async () => {
    const root = await mkTmpRoot();
    try {
      const payloadPath = path.join(root, "record-payload.json");
      await fs.writeFile(
        payloadPath,
        JSON.stringify({
          id: "record:wi-207-generic",
          summary: "Generic record",
          observation: "Generic record created through the record command.",
          outcome: "noted",
          subjects: ["[[wi-207]]"],
        }),
      );

      const result = JSON.parse(
        runCli(root, [
          "record",
          "create",
          "--type",
          "audit-note",
          "--payload",
          payloadPath,
          "--json",
        ]),
      ) as { id: string; filePath: string; dryRun: boolean };

      expect(result).toMatchObject({
        id: "record:wi-207-generic",
        dryRun: false,
      });
      const record = await fs.readFile(result.filePath, "utf8");
      expect(record).toContain(
        "Generic record created through the record command.",
      );
      expect(record).toContain("[[wi-207]]");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("requires --claim for public records whose subject is actively claimed Work", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "208-public-record.md",
        `id: wi-208-public-record
title: Public record Claim guard
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      const payloadPath = path.join(root, "public-record-payload.json");
      await fs.writeFile(
        payloadPath,
        JSON.stringify({
          id: "record:wi-208-public",
          summary: "Public claimed evidence",
          observation: "The public record command must be Claim-aware.",
          subjects: ["[[wi-208-public-record]]"],
        }),
        "utf8",
      );
      const claimToken = acquireRuntimeTaskClaim(root, "wi-208-public-record", [
        path.join(root, "backlog", "208-public-record.md"),
        path.join(root, "backlog", "records", "record-wi-208-public.md"),
      ]);

      expect(() =>
        runCli(root, [
          "record",
          "create",
          "--type",
          "test-result",
          "--payload",
          payloadPath,
        ]),
      ).toThrow(/exact active claim token/i);
      const result = JSON.parse(
        runCli(root, [
          "record",
          "create",
          "--type",
          "test-result",
          "--payload",
          payloadPath,
          "--claim",
          claimToken,
          "--json",
        ]),
      ) as { id: string };
      expect(result.id).toBe("record:wi-208-public");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 15_000);

  it(
    "accepts runtime claim tokens when recording evidence through the task command",
    { timeout: 15_000 },
    async () => {
      const root = await mkTmpRoot();
      try {
        await writeTask(
          root,
          "206-runtime-record.md",
          `id: wi-206-runtime-record
title: Runtime Record
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
        );

        const created = JSON.parse(
          runCli(root, [
            "claim",
            "create",
            "--target",
            "task:wi-206-runtime-record",
            "--holder",
            "cli-claim-test",
            "--json",
          ]),
        ) as { outcome: string; claimToken: string };
        expect(created.outcome).toBe("acquired");

        const store = openRuntimeSqliteStore({ rootDir: root });
        try {
          store.acquireRuntimeLocks(created.claimToken, [
            path.join(root, "backlog", "206-runtime-record.md"),
            path.join(
              root,
              "backlog",
              "records",
              "record-wi-206-runtime-record-evidence.md",
            ),
          ]);
        } finally {
          store.close();
        }

        const result = JSON.parse(
          runCli(
            root,
            [
              "work", "wi-206-runtime-record", "record", "--claim", created.claimToken,
              "--type", "test-result", "--payload", "-", "--json",
            ],
            JSON.stringify({
              id: "record:wi-206-runtime-record-evidence",
              summary: "Runtime claim evidence",
              observation:
                "Runtime claim token accepted by the task record command.",
              outcome: "pass",
            }),
          ),
        ) as { taskId: string; evidenceLink: string };

        expect(result).toMatchObject({
          taskId: "wi-206-runtime-record",
          evidenceLink: "[[record-wi-206-runtime-record-evidence]]",
        });
        const record = await fs.readFile(
          path.join(
            root,
            "backlog",
            "records",
            "record-wi-206-runtime-record-evidence.md",
          ),
          "utf8",
        );
        expect(record).toContain(`- claim:${created.claimToken}`);
        expect(record).toContain("- wi-206-runtime-record");
        expect(record).toContain("- wi:206-runtime-record");
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

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
          observation: "missing summary",
        }),
      ).toThrowError(/summary/);
      const authority = openRuntimeSqliteStore({ rootDir: root });
      authority.close();
      await expect(
        recordTaskEvidence({
          rootDir: root,
          claimStorePath: claimStorePath(root),
          claimId: "claim-missing",
          type: "test-result",
          payload: validateTaskRecordPayload({
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
          type: "test-result",
          payload: validateTaskRecordPayload({
            id: "record:should-not-write",
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
      acquireRuntimeTaskClaim(root, "wi-208", [
        path.join(root, "backlog", "208-transition.md"),
      ]);

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

  it("publishes collection-only help at the Work root", async () => {
    const root = await mkTmpRoot();
    try {
      const help = runCli(root, ["work", "--help"]);
      expect(help).toContain("ready");
      expect(help).toContain("list");
      expect(help).not.toContain("show");
      expect(help).not.toContain("prompt");
      expect(help).not.toContain("claim");
      expect(help).not.toContain("record");
      expect(help).not.toMatch(/^\s+claim-for\b/m);
      expect(help).not.toMatch(/^\s+claims\b/m);
      expect(help).not.toMatch(/^\s+release\b/m);
      expect(help).not.toMatch(/^\s+transition\b/m);
      expect(help).not.toMatch(/^\s+close\b/m);
      expect(help).not.toMatch(/^\s+link\b/m);
      expect(help).not.toMatch(/^\s+record-commit\b/m);
      expect(help).not.toMatch(/^\s+finalize\b/m);
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
        `## Tasks

- [x] Execute work

## Acceptance Criteria

- [x] Do the thing
`,
      );
      const claim = await claimTask("wi-209", {
        rootDir: root,
        claimStorePath: claimStorePath(root),
        holder: "agent-a",
      });
      acquireRuntimeTaskClaim(root, "wi-209", [
        path.join(root, "backlog", "209-close-no-evidence.md"),
      ]);

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

  it("supports claim-bound completion after evidence and rejects stale from status", async () => {
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
        `## Tasks

- [x] Execute work

## Acceptance Criteria

- [x] Do the thing
`,
      );
      const claim = await claimTask("wi-210", {
        rootDir: root,
        claimStorePath: claimStorePath(root),
        holder: "agent-a",
      });
      acquireRuntimeTaskClaim(root, "wi-210", [
        path.join(root, "backlog", "210-close.md"),
        path.join(root, "backlog", "records", "record-wi-210-close.md"),
      ]);
      await runCli(
        root,
        [
          "work", "wi-210", "record", "--claim", claim.claimId,
          "--type", "test-result", "--payload", "-", "--json",
        ],
        JSON.stringify({
          id: "record:wi-210-close",
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
        validateTaskTransitionPayload({
          status: "completed",
          completedDate: "2000-01-01",
        }),
      ).toThrow(/unsupported field\(s\): completedDate/i);
      await expect(
        transitionTask({
          rootDir: root,
          claimStorePath: claimStorePath(root),
          claimId: claim.claimId,
          expectedFromStatus: "running",
          status: "completed",
          statusReason: "completed",
        }),
      ).rejects.toMatchObject({ code: "TASK_TRANSITION_FROM_STATUS_MISMATCH" });

      const closed = await transitionTask({
        rootDir: root,
        claimStorePath: claimStorePath(root),
        claimId: claim.claimId,
        status: "completed",
        statusReason: "completed",
        actual: 1.5,
      });
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

  it("blocks completion when changed-file audit sees unlocked paths", async () => {
    const root = await mkTmpRoot();
    try {
      initGitRepo(root);
      await fs.writeFile(path.join(root, "README.md"), "base\n", "utf8");
      await fs.writeFile(
        path.join(root, ".gitignore"),
        ".doc-vader/runtime/\n",
        "utf8",
      );
      execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "chore: base"], {
        cwd: root,
        stdio: "ignore",
      });
      await writeTask(
        root,
        "214-completion-audit.md",
        `id: wi-214
title: Completion Audit
type: work-item
lifecycle: active
status: ready
status_reason: auto
tags:
  - afk
links:
  evidence:
    - '[[record-wi-214-completion]]'`,
      );
      const claim = await claimTask("wi-214", {
        rootDir: root,
        claimStorePath: claimStorePath(root),
        holder: "agent-a",
      });
      acquireRuntimeTaskClaim(root, "wi-214", [
        path.join(root, "backlog", "214-completion-audit.md"),
      ]);
      await fs.writeFile(path.join(root, "notes.txt"), "dirty\n", "utf8");

      await expect(
        transitionTask({
          rootDir: root,
          claimStorePath: claimStorePath(root),
          claimId: claim.claimId,
          status: "completed",
          statusReason: "completed",
        }),
      ).rejects.toMatchObject({
        code: "TASK_TRANSITION_CHANGED_FILE_LOCK_AUDIT_FAILED",
      });
      const workItem = await fs.readFile(
        path.join(root, "backlog/214-completion-audit.md"),
        "utf8",
      );
      expect(workItem).toContain("status: ready");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("supports the full dogfood flow without hand-editing backlog evidence", async () => {
    const root = await mkTmpRoot();
    try {
      ensureRuntimeClaimAuthority(root);
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

      const ready = JSON.parse(runCli(root, ["work", "ready", "--json"]));
      expect(ready.candidates.map((task: { id: string }) => task.id)).toEqual([
        "wi-208",
      ]);

      const claim = await claimTask("wi-208", {
        rootDir: root,
        claimStorePath: claimStorePath(root),
        holder: "sandcastle",
        branch: "feature/wi-208",
        worktreePath: root,
      });
      acquireRuntimeTaskClaim(
        root,
        "wi-208",
        [
          path.join(root, "backlog", "208-dogfood.md"),
          path.join(root, "backlog", "records", "record-wi-208-dogfood.md"),
        ],
        "sandcastle",
      );
      expect(claim.state).toBe("active");

      const show = JSON.parse(
        runCli(root, ["work", "wi-208", "show", "--json"]),
      );
      expect(show).toMatchObject({ id: "wi-208", title: "Dogfood" });
      const prompt = runCli(root, ["work", "wi-208", "prompt"]);
      expect(prompt).toContain(
        "Implement `Dogfood` from `backlog/208-dogfood.md`.",
      );

      const evidence = JSON.parse(
        runCli(
          root,
          [
            "work", "wi-208", "record", "--claim", claim.claimId,
            "--type", "test-result", "--payload", "-", "--json",
          ],
          JSON.stringify({
            id: "record:wi-208-dogfood",
            summary: "Dogfood validation",
            observation:
              "Ready, claim, show, prompt, record, and release passed.",
            outcome: "pass",
          }),
        ),
      );
      expect(evidence).toMatchObject({
        taskId: "wi-208",
        evidenceLink: "[[record-wi-208-dogfood]]",
      });

      const released = await releaseClaim(claim.claimId, {
        rootDir: root,
        claimStorePath: claimStorePath(root),
      });
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

  it("documents the authoritative dv4sandcastle contract for the dogfood flow", async () => {
    const guide = await fs.readFile(
      path.resolve(__dirname, "../docs/how-to/sandcastle-dogfood-task-flow.md"),
      "utf8",
    );

    for (const fragment of [
      "## Initialization",
      "`pnpm install --frozen-lockfile`",
      "`export CI=true`",
      "`export TMPDIR=/tmp`",
      "committed convenience copies",
      "`node --import tsx scripts/sandcastle/dv4sandcastle.ts list`",
      "## Authority Model",
      "[`dv work <work-item-id> <operation>`](../reference/work-management/work-item-lifecycle-commands.md) is the canonical public command surface and the only Work Item command grammar.",
      "`dv wi` and `dv task` are unavailable.",
      "## Sandcastle Adapter Contract",
      "`node --import tsx scripts/sandcastle/dv4sandcastle.ts view <task-id>`",
      "`node --import tsx scripts/sandcastle/dv4sandcastle.ts prompt <task-id>`",
      "`node --import tsx scripts/sandcastle/dv4sandcastle.ts claim-task <task-id> --holder <holder> --branch <branch> --json`",
      "`node --import tsx scripts/sandcastle/dv4sandcastle.ts lock-status --claim <claim-id> --json`",
      "`node --import tsx scripts/sandcastle/dv4sandcastle.ts record-task --claim <claim-id> --type <record-type> --payload <json-file\\|-> --json`",
      "`node --import tsx scripts/sandcastle/dv4sandcastle.ts recover-task <task-id> --branch <branch> --json`",
      "`node --import tsx scripts/sandcastle/dv4sandcastle.ts close-task <task-id> --claim <claim-id> [--payload <json-file>] [--record-type <type>]`",
      "`selectable`",
      "Non-selectable horizon entries are intentionally withheld from the list",
      "repository-configured transition script",
      ".sandcastle/SETUP_ISSUE_TRACKER.md",
      ".sandcastle/VALIDATION.md",
      "`pnpm run backlog:validate:ci`",
      "Completed backlog items remain historical context, not authoritative current guidance.",
    ] as const) {
      expect(guide).toContain(fragment);
    }

    expect(guide).not.toContain("`dv task ready --json`");
    expect(guide).not.toContain(
      "`dv task claim <task-id> --holder <agent-id> --branch <branch> --json`",
    );
  });

  it("keeps lifecycle audits authoritative even when hook bypass env is set", async () => {
    const root = await mkTmpRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      await writeTask(
        root,
        "213-hook-bypass.md",
        `id: wi-213
title: Hook Bypass
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );

      await fs.writeFile(path.join(root, "README.md"), "base\n", "utf8");
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
      await fs.writeFile(
        path.join(root, ".gitignore"),
        ".doc-vader/runtime/\n",
        "utf8",
      );
      execFileSync("git", ["add", "README.md", "backlog/213-hook-bypass.md"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync("git", ["commit", "-m", "chore: base"], {
        cwd: root,
        stdio: "ignore",
      });
      await fs.appendFile(path.join(root, "README.md"), "dirty\n");

      const createdAt = new Date();
      const acquisition = store.acquireRuntimeClaim({
        schema_version: RUNTIME_SCHEMA_VERSION,
        target_type: "task",
        target_id: "wi-213",
        holder: "agent-a",
        created_at: createdAt.toISOString(),
        expires_at: new Date(createdAt.getTime() + 60 * 60_000).toISOString(),
        entropy: "entropy-hook-bypass",
      });
      if (acquisition.outcome !== "acquired") {
        throw new Error("Expected the claim to be acquired.");
      }
      const claim = { claimId: acquisition.claimToken };

      expect(() =>
        runCli(
          root,
          [
            "work", "wi-213", "record", "--claim", claim.claimId,
            "--type", "test-result", "--payload", "-", "--json",
          ],
          JSON.stringify({
            id: "record:wi-213-hook-bypass",
            summary: "Hook bypass audit",
            observation:
              "Direct lifecycle checks still run with HUSKY disabled.",
            outcome: "pass",
          }),
          { HUSKY: "0" },
        ),
      ).toThrow(/TASK_RECORD_CHANGED_FILE_LOCK_AUDIT_FAILED/);
    } finally {
      store.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});
