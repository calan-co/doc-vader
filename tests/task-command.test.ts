import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
import {
  openRuntimeSqliteStore,
  RUNTIME_SCHEMA_VERSION,
} from "../lib/runtime/sqlite-store.js";
import { WORK_COMMAND_ALIASES } from "../lib/work/command-inventory.js";
import { stageWorkGraphUacFixture } from "./helpers/work-graph-uac-fixture";

const cliPath = path.resolve(__dirname, "../cli/doc-vader.ts");
const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const claimStoreEnv = "DOC_VADER_TASK_CLAIM_STORE";
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

function runCliJson<T>(root: string, args: string[]): T {
  return JSON.parse(runCli(root, args)) as T;
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
      expect(prompt).toContain("Use `dv work show wi-101 --json`");
      expect(prompt).toContain("Templjs rendering is presentation only");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it(
    "shows and prompts from the canonical task JSON at the CLI boundary",
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
        const showOutput = runCli(root, ["task", "show", "101", "--json"]);
        const promptOutput = runCli(root, ["task", "prompt", "101"]);

        expect(JSON.parse(showOutput)).toEqual(canonicalTask);
        expect(promptOutput.trimEnd()).toBe(
          (await renderSandcastlePrompt({ task: canonicalTask })).trimEnd(),
        );
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "exposes work and wi aliases with the same canonical show output",
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

        const canonicalWorkItem = await loadCanonicalTask({
          rootDir: root,
          taskId: "101",
        });
        expect(
          JSON.parse(runCli(root, ["work", "show", "101", "--json"])),
        ).toEqual(canonicalWorkItem);
        expect(
          JSON.parse(runCli(root, ["wi", "show", "101", "--json"])),
        ).toEqual(canonicalWorkItem);
        expect(
          JSON.parse(runCli(root, ["task", "show", "101", "--json"])),
        ).toEqual(canonicalWorkItem);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

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
  evidence:
    - '[[records/record-wi-60396-show-evidence.md]]'`,
          `## Goal

Keep the body content stable.

## Notes

The body section text must still render.

## Relationships

- \`depends_on\`: [[wi-60395]]
- \`part_of\`: [[project:graph-backed-show]]
- \`implements\`: [[../docs/how-to/implementation-plans/show-relationships-prd.md]]
- \`blocks\`: [[wi-99999]]
- \`relates_to\`: [[wi-88888]]
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
        const showText = runCli(root, ["wi", "show", "60396"]);
        const showJson = runCliJson<{
          dependencies: Array<{ type: string; target: string }>;
          relationships?: Array<{ type: string; target: string }>;
          records?: Array<{ type: string; target: string }>;
          activeLocks?: Array<{
            claimToken: string;
            scopeRef: string;
            lockMode: string;
          }>;
        }>(root, ["wi", "show", "60396", "--json"]);
        const prompt = runCli(root, ["wi", "prompt", "60396"]);

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
    "keeps task, work, and wi list output aligned while selecting only backlog work items",
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

        const taskJson = runCliJson<{
          schemaVersion: string;
          tasks: Array<{ id: string; title: string; filePath: string }>;
        }>(root, ["task", "list", "--json"]);
        const workJson = runCliJson<{
          schemaVersion: string;
          tasks: Array<{ id: string; title: string; filePath: string }>;
        }>(root, ["work", "list", "--json"]);
        const wiJson = runCliJson<{
          schemaVersion: string;
          tasks: Array<{ id: string; title: string; filePath: string }>;
        }>(root, ["wi", "list", "--json"]);

        expect(taskJson).toEqual(workJson);
        expect(workJson).toEqual(wiJson);
        expect(taskJson).toEqual({
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

        const taskText = runCli(root, ["task", "list"]);
        const workText = runCli(root, ["work", "list"]);
        const wiText = runCli(root, ["wi", "list"]);
        expect(taskText).toBe(workText);
        expect(workText).toBe(wiText);
        expect(taskText).toContain("wi-100 | ready | Backlog Item");
        expect(taskText).not.toContain("wi-999");
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it(
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
    - '[[60392-live-repository-graph-projection-robustness]]'`,
          `## Goal

Inspect the projected work graph.

## Relationships

- \`implements\`: [[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]
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
      ).resolves.toMatchObject({ state: "active", taskId: "wi-103" });
      await expect(
        releaseClaim(claim.claimId, {
          rootDir: root,
          claimStorePath: claimStorePath(root),
          now,
        }),
      ).resolves.toMatchObject({ state: "released", taskId: "wi-103" });
      await expect(
        getClaimStatus("claim-missing", {
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

  it("supports a shared claim store path for worktree mutexes", async () => {
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
        ).rejects.toMatchObject({ code: "TASK_CLAIM_CONFLICT" });
        await expect(
          getClaimStatus(claim.claimId, { rootDir: otherRoot }),
        ).resolves.toMatchObject({ state: "active", taskId: "wi-106" });
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
          ttlMinutes: 1,
          now: new Date("2026-06-15T12:00:00.000Z"),
        });
        acquireRuntimeTaskClaim(
          root,
          "wi-107",
          ["README.md", ".gitignore"],
          "agent-a",
        );
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
          ttlMinutes: 1,
          now: new Date("2026-06-15T12:00:00.000Z"),
        });
        acquireRuntimeTaskClaim(root, "wi-211", [".gitignore"], "agent-a");
        const later = new Date("2026-06-15T12:02:00.000Z");

        await expect(
          recoverClaim(claim.claimId, {
            rootDir: root,
            claimStorePath: claimStorePath(root),
            action: "adopt",
            holder: "agent-b",
            now: later,
          }),
        ).rejects.toMatchObject({
          code: "TASK_RECOVERY_CHANGED_FILE_LOCK_AUDIT_FAILED",
        });
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it("recovers halted tasks to ready/recoverable on a clean worktree", async () => {
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

      const output = JSON.parse(
        runCli(root, ["task", "recover", "wi-300", "--json"]),
      ) as {
        claimToken: string;
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
      const store = openRuntimeSqliteStore({ rootDir: root });
      try {
        expect(store.listClaims()).toHaveLength(0);
        expect(store.listLocks()).toHaveLength(0);
        expect(store.listExecutionLogEntries()).toHaveLength(3);
        expect(store.listExecutionLogEntries()[2]).toMatchObject({
          claim_token: output.claimToken,
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
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("refuses dirty recovery without force", async () => {
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
        runCli(root, ["task", "recover", "wi-301", "--json"]),
      ).toThrow(/TASK_RECOVERY_DIRTY_WORKTREE/);
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
          runCli(rootClean, [
            "task",
            "recover",
            "wi-302",
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
          runCli(rootReconcile, [
            "task",
            "recover",
            "wi-303",
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
            runCli(root, [
              "task",
              "recover",
              "wi-305",
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
        runCli(root, [
          "task",
          "recover",
          "wi-304",
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

      const show = JSON.parse(runCli(root, ["task", "show", "105", "--json"]));
      expect(show.id).toBe("wi-105");
      const claim = await claimTask("wi-105", {
        rootDir: root,
        claimStorePath: claimStorePath(root),
        holder: "agent-a",
      });
      expect(claim).toMatchObject({ taskId: "wi-105", state: "active" });
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
          runCli(root, ["task", "show", "106", "--json"]),
        );
        const status = JSON.parse(
          runCli(root, ["task", "status", "106", "--json"]),
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
          runCli(root, ["task", "status", "106", "--worktree", root, "--json"]),
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
  reference:
    - '[[wi-110]]'`,
          `## Goal

Inspect graph-informed task status.

## Relationships

- \`part_of\`: [[project:graph-status]]
- \`implements\`: [[../docs/how-to/implementation-plans/graph-status-prd.md]]
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
        }>(root, ["task", "status", "108", "--json"]);
        const statusText = runCli(root, ["task", "status", "108"]);

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
            target: "[[wi-110]]",
            resolvedTargetId: "wi:110",
          },
        ]);
        expect(statusText).toContain("Graph");
        expect(statusText).toContain(
          "- relationships: belongs_to=[[project:graph-status]], depends_on=[[wi-109]]",
        );
        expect(statusText).toContain(
          "- informational references: reference=[[wi-110]]",
        );
        expect(statusText).toContain(
          "- projection diagnostics: implements=[[../docs/how-to/implementation-plans/graph-status-prd.md]] (non-canonical-document-id)",
        );

        const claimed = JSON.parse(
          runCli(root, [
            "task",
            "claim",
            "108",
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
            }>(root, [alias, "status", "70001", "--json"]),
          ]),
        );
        const statusTextByAlias = new Map(
          WORK_COMMAND_ALIASES.map((alias) => [
            alias,
            runCli(root, [alias, "status", "70001"]),
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

  it("resolves task status from an unambiguous sandcastle branch worktree", async () => {
    const root = await mkTmpRoot();
    const worktreeRoot = `${root}-issue-106-worktree`;
    try {
      initGitRepo(root);
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
        runCli(root, ["task", "status", "106-worktree", "--json"]),
      );
      const normalizedWorktreeRoot = await fs.realpath(worktreeRoot);

      expect(status).toMatchObject({
        id: "wi-106-worktree",
        recovery: {
          gitState: {
            currentBranch: "sandcastle/issue-106-worktree",
            currentWorktree: normalizedWorktreeRoot,
            expectedWorktree: normalizedWorktreeRoot,
            lineageKnown: true,
            worktreeLineageKnown: true,
          },
        },
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
      recordRuntimeExecutionLog(worktreeRoot, {
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
        runCli(root, ["task", "recover", "wi-106-recover-worktree", "--json"]),
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
          runCli(root, [
            "task",
            "claim",
            "wi-106-claim-recoverable",
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
          runCli(root, [
            "task",
            "status",
            "wi-106-claim-recoverable",
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
        runCli(root, [
          "task",
          "claim",
          "106-claim",
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
    "requires force to recover ready tasks with uncertain branch lineage",
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
          runCli(root, ["task", "recover", "wi-106-recover", "--json"]),
        ).toThrow(/TASK_RECOVERY_FORCE_REQUIRED/);

        const dryRun = JSON.parse(
          runCli(root, [
            "task",
            "recover",
            "wi-106-recover",
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
          runCli(root, ["task", "ready", "--json"]),
        ) as {
          candidates: Array<{ id: string }>;
        };
        expect(
          stillBlocked.candidates.map((candidate) => candidate.id),
        ).not.toContain("wi-106-recover");

        const recovered = JSON.parse(
          runCli(root, [
            "task",
            "recover",
            "wi-106-recover",
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

        const ready = JSON.parse(runCli(root, ["task", "ready", "--json"])) as {
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
        runCli(root, ["task", "recover", "wi-106-cancelled-active", "--json"]),
      ).toThrow(/TASK_RECOVERY_INVALID_STATUS/);

      const readyText = runCli(root, ["task", "ready"]);
      expect(readyText).not.toContain("wi-106-cancelled-active");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

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
        runCli(root, ["task", "claim", "107", "--holder", "agent-a", "--json"]),
      ).toThrow();
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

        expect(report.candidates.map((task) => task.id)).toEqual([
          "wi-200",
          "wi-203",
        ]);
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
          { id: "wi-204", codes: ["missing_classification"] },
          { id: "wi-205", codes: ["invalid"] },
          { id: "wi-206", codes: ["closed", "not_ready", "not_active"] },
          { id: "wi-207", codes: ["blocked", "not_ready"] },
          { id: "wi-209", codes: ["closed", "not_ready", "not_active"] },
          { id: "wi-210", codes: ["dependency_blocked", "not_ready"] },
          { id: "wi-211", codes: ["execution_not_ready"] },
          { id: "wi-212", codes: ["execution_not_ready"] },
          { id: "wi-208", codes: ["archived"] },
        ]);
        const porcelain = runCli(root, ["task", "ready", "--porcelain"]);
        expect(porcelain.trim()).toBe(
          [
            "wi-200\tbacklog/200-ready.md\tReady",
            "wi-203\tbacklog/203-dependency.md\tDependency",
          ].join("\n"),
        );
        const text = runCli(root, ["task", "ready"]);
        expect(text).toContain("Ready work candidates");
        expect(text).toContain("Candidates: 2");
        expect(text).toContain("Recoverable with --force: 2 (wi-211, wi-212)");
        expect(text).toContain(
          "Branch lineage or task-local dirty state is uncertain",
        );
        expect(text).toContain("- wi-200 | Ready | backlog/200-ready.md");
        expect(text).toContain(
          "- wi-203 | Dependency | backlog/203-dependency.md",
        );
        expect(text).not.toContain("Excluded");
        expect(text).not.toContain("HITL tasks are not AFK-ready candidates.");
        const json = JSON.parse(runCli(root, ["task", "ready", "--json"]));
        expect(json.schemaVersion).toBe("task-ready/v1");
        expect(json.candidates).toHaveLength(2);
        expect(json.exclusions).toHaveLength(11);
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
        const listText = runCli(root, ["task", "list"]);
        expect(listText).toContain("wi-200 | ready | Ready");
        expect(listText).toContain("wi-211 | ready | Runtime Blocked");
        expect(listText).toContain("wi-212 | ready | Runtime Cancelled");
        expect(listText).not.toContain("wi-206");
        const candidatesOnly = JSON.parse(
          runCli(root, ["task", "ready", "--json", "--candidates-only"]),
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
        runCli(root, ["task", "ready", "--json", "--candidates-only"]),
      ) as {
        candidates: Array<{ id: string }>;
      };

      expect(ready.candidates.map((candidate) => candidate.id)).toEqual([
        "wi-200",
      ]);

      const claimed = JSON.parse(
        runCli(root, [
          "task",
          "claim",
          ready.candidates[0]!.id,
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
  });

  it("uses the issue worktree as task authority for ready and claim", async () => {
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

      const store = openRuntimeSqliteStore({ rootDir: worktreeRoot });
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
        runCli(root, ["task", "ready", "--json", "--candidates-only"]),
      ) as {
        candidates: Array<{ id: string }>;
      };
      expect(ready.candidates.map((candidate) => candidate.id)).not.toContain(
        "wi-202",
      );

      let claimError: unknown;
      try {
        runCli(root, ["task", "claim", "wi-202", "--json"]);
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

  it("uses projected depends_on relationships during ready selection", async () => {
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
  - afk`,
        `## Goal

Prove graph-backed ready selection uses projected dependency edges.

## Relationships

- \`depends_on\`: [[wi-215]]
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
          "task",
          "record",
          "--claim",
          claim.claimId,
          "--type",
          "test-result",
          "--payload",
          payloadPath,
          "--json",
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
            "task",
            "record",
            "--claim",
            secondClaim.claimId,
            "--type",
            "test-result",
            "--payload",
            "-",
            "--json",
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
              "task",
              "record",
              "--claim",
              created.claimToken,
              "--type",
              "test-result",
              "--payload",
              "-",
              "--json",
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

  it("keeps task CLI focused on selection, context, claims, and records", async () => {
    const root = await mkTmpRoot();
    try {
      const help = runCli(root, ["task", "--help"]);
      expect(help).toContain("ready");
      expect(help).toContain("show");
      expect(help).toContain("prompt");
      expect(help).toContain("claim");
      expect(help).toContain("record");
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
        "## Acceptance Criteria\n\n- [x] Do the thing\n",
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
        "## Acceptance Criteria\n\n- [x] Do the thing\n",
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
          "task",
          "record",
          "--claim",
          claim.claimId,
          "--type",
          "test-result",
          "--payload",
          "-",
          "--json",
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

      const ready = JSON.parse(runCli(root, ["task", "ready", "--json"]));
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
        runCli(root, ["task", "show", "wi-208", "--json"]),
      );
      expect(show).toMatchObject({ id: "wi-208", title: "Dogfood" });
      const prompt = runCli(root, ["task", "prompt", "wi-208"]);
      expect(prompt).toContain(
        "Implement `Dogfood` from `backlog/208-dogfood.md`.",
      );

      const evidence = JSON.parse(
        runCli(
          root,
          [
            "task",
            "record",
            "--claim",
            claim.claimId,
            "--type",
            "test-result",
            "--payload",
            "-",
            "--json",
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
      "`pnpm install`",
      "`export CI=true`",
      "`export TMPDIR=/tmp`",
      "`node --import tsx scripts/sandcastle/dv4sandcastle.ts list`",
      "## Authority Model",
      "`dv work` is the canonical public command surface.",
      "`dv wi` is the shorthand alias.",
      "`dv task` appears only in historical backlog or ADR context and is not current operator guidance.",
      "## Sandcastle Adapter Contract",
      "`node --import tsx scripts/sandcastle/dv4sandcastle.ts view <task-id>`",
      "`node --import tsx scripts/sandcastle/dv4sandcastle.ts prompt <task-id>`",
      "`node --import tsx scripts/sandcastle/dv4sandcastle.ts claim-task <task-id> --holder <holder> --branch <branch> --json`",
      "`node --import tsx scripts/sandcastle/dv4sandcastle.ts lock-status --claim <claim-id> --json`",
      "`node --import tsx scripts/sandcastle/dv4sandcastle.ts record-task --claim <claim-id> --type <record-type> --payload <json-file|-> --json`",
      "`node --import tsx scripts/sandcastle/dv4sandcastle.ts recover-task <task-id> --branch <branch> --json`",
      "`node --import tsx scripts/sandcastle/dv4sandcastle.ts close-task <task-id> --claim <claim-id> [--payload <json-file>] [--record-type <type>]`",
      "`selectable`",
      "Non-selectable horizon entries are intentionally withheld from the list",
      "repository-configured transition script",
      ".sandcastle/SETUP_ISSUE_TRACKER.md",
      "Completed backlog items remain historical context, not authoritative current guidance.",
    ] as const) {
      expect(guide).toContain(fragment);
    }

    expect(guide).not.toContain("`dv task ready --json`");
    expect(guide).not.toContain("`dv task claim <task-id> --holder <agent-id> --branch <branch> --json`");
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

      const acquisition = store.acquireRuntimeClaim({
        schema_version: RUNTIME_SCHEMA_VERSION,
        target_type: "task",
        target_id: "wi-213",
        holder: "agent-a",
        created_at: "2026-06-15T12:00:00.000Z",
        expires_at: "2026-06-15T13:00:00.000Z",
        entropy: "entropy-hook-bypass",
      });
      if (acquisition.outcome !== "acquired") {
        throw new Error("Expected the claim to be acquired.");
      }
      const claim = await claimTask("wi-213", {
        rootDir: root,
        claimStorePath: claimStorePath(root),
        holder: "agent-a",
      });

      expect(() =>
        runCli(
          root,
          [
            "task",
            "record",
            "--claim",
            claim.claimId,
            "--type",
            "test-result",
            "--payload",
            "-",
            "--json",
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
