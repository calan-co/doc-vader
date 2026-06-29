import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { claimTask } from "../lib/task/claims.js";
import { loadTaskPromptModel } from "../lib/task/prompt.js";
import { selectReadyTasks } from "../lib/task/ready.js";
import { loadTaskShowModel } from "../lib/task/show.js";
import { transitionTask } from "../lib/task/transition.js";
import * as projectionModule from "../lib/work/projection.js";
import type {
  WorkGraphEdge,
  WorkGraphNode,
  WorkGraphProjection,
  WorkGraphProjectionDiagnostic,
} from "../lib/work/projection.js";

function claimStorePath(rootDir: string): string {
  return path.join(rootDir, ".doc-vader", "runtime", "task-claims");
}

async function mkTmpRoot(): Promise<string> {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "doc-vader-work-command-authority-"),
  );
  await fs.mkdir(path.join(rootDir, "backlog"), { recursive: true });
  await fs.mkdir(path.join(rootDir, ".doc-vader"), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, ".doc-vader", "backlog-consumer.json"),
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
  return rootDir;
}

async function writeTask(
  rootDir: string,
  fileName: string,
  frontmatter: string,
  body = "## Goal\n\nExercise command authority.\n",
): Promise<void> {
  await fs.writeFile(
    path.join(rootDir, "backlog", fileName),
    `---\n${frontmatter.trim()}\n---\n\n${body}`,
    "utf8",
  );
}

async function withTmpRoot(run: (rootDir: string) => Promise<void>): Promise<void> {
  const rootDir = await mkTmpRoot();
  try {
    await run(rootDir);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

function createProjection(options: {
  nodes: readonly WorkGraphNode[];
  edges: readonly WorkGraphEdge[];
  diagnostics?: readonly WorkGraphProjectionDiagnostic[];
}): WorkGraphProjection {
  const nodes = [...options.nodes];
  const edges = [...options.edges];
  const diagnostics = [...(options.diagnostics ?? [])];
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));

  return {
    nodes,
    edges,
    diagnostics,
    findNode(id) {
      return nodeById.get(id);
    },
    getNodesByType(type) {
      return nodes.filter((node) => node.type === type);
    },
    getEdgesByType(type) {
      return edges.filter((edge) => edge.type === type);
    },
    getOutgoingEdges(nodeId) {
      return edges.filter((edge) => edge.from === nodeId);
    },
    getIncomingEdges(nodeId) {
      return edges.filter((edge) => edge.to === nodeId);
    },
  };
}

function createWorkItemNode(options: {
  taskNumber: string;
  fileName: string;
  title: string;
  status: string;
}): WorkGraphNode {
  const { taskNumber, fileName, title, status } = options;
  return {
    id: `wi:${taskNumber}`,
    type: "work-item",
    stableId: `wi:${taskNumber}`,
    label: title,
    source: {
      kind: "work-item",
      filePath: `backlog/${fileName}`,
    },
    properties: {
      frontmatterId: `wi-${taskNumber}`,
      status,
      lifecycle: "active",
    },
  };
}

function createInformationalEdge(options: {
  id: string;
  type: WorkGraphEdge["type"];
  from: string;
  to: string;
  source: WorkGraphEdge["source"];
  properties: WorkGraphEdge["properties"];
}): WorkGraphEdge {
  return {
    ...options,
    authority: "informational",
    direction: "authored",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("immutable work command authority gate", () => {
  it("ignores informational governance-like edges for show, prompt, and ready", async () => {
    await withTmpRoot(async (rootDir) => {
      await writeTask(
        rootDir,
        "300-authority-source.md",
        `id: wi-300
title: Authority Source
type: work-item
lifecycle: active
status: ready
tags:
  - afk`,
      );
      await writeTask(
        rootDir,
        "301-authority-target.md",
        `id: wi-301
title: Authority Target
type: work-item
lifecycle: active
status: blocked
tags:
  - afk`,
      );

      const projection = createProjection({
        nodes: [
          createWorkItemNode({
            taskNumber: "300",
            fileName: "300-authority-source.md",
            title: "Authority Source",
            status: "ready",
          }),
          createWorkItemNode({
            taskNumber: "301",
            fileName: "301-authority-target.md",
            title: "Authority Target",
            status: "blocked",
          }),
        ],
        edges: [
          createInformationalEdge({
            id: "wi:300::depends_on::wi:301",
            type: "depends_on",
            from: "wi:300",
            to: "wi:301",
            source: {
              kind: "relationships",
              filePath: "backlog/300-authority-source.md",
            },
            properties: {
              sourceKey: "reference",
              rawTarget: "[[wi-301]]",
              resolvedTargetId: "wi:301",
            },
          }),
          createInformationalEdge({
            id: "wi:300::belongs_to::scope:project:shadow",
            type: "belongs_to",
            from: "wi:300",
            to: "scope:project:shadow",
            source: {
              kind: "relationships",
              filePath: "backlog/300-authority-source.md",
            },
            properties: {
              sourceKey: "reference",
              rawTarget: "[[project:shadow]]",
              resolvedTargetId: "scope:project:shadow",
            },
          }),
          createInformationalEdge({
            id: "wi:300::implements::scope:plan:shadow-prd",
            type: "implements",
            from: "wi:300",
            to: "scope:plan:shadow-prd",
            source: {
              kind: "relationships",
              filePath: "backlog/300-authority-source.md",
            },
            properties: {
              sourceKey: "reference",
              rawTarget: "[[../docs/how-to/implementation-plans/shadow-prd.md]]",
              resolvedTargetId: "scope:plan:shadow-prd",
            },
          }),
          createInformationalEdge({
            id: "record:shadow::records::wi:300",
            type: "records",
            from: "record:shadow",
            to: "wi:300",
            source: {
              kind: "runtime",
            },
            properties: {
              sourceKey: "reference",
              rawTarget: "[[records/shadow]]",
              resolvedTargetId: "record:shadow",
            },
          }),
          createInformationalEdge({
            id: "claim:shadow::locks::scope:wi:300",
            type: "locks",
            from: "claim:shadow",
            to: "scope:wi:300",
            source: {
              kind: "runtime",
              claimToken: "claim:shadow",
            },
            properties: {
              claimToken: "claim:shadow",
              scopeRef: "wi:300",
              lockMode: "execute",
            },
          }),
        ],
      });

      vi.spyOn(projectionModule, "projectWorkGraph").mockResolvedValue(projection);

      const showModel = await loadTaskShowModel({
        rootDir,
        taskId: "300",
      });
      const promptModel = await loadTaskPromptModel({
        rootDir,
        taskId: "300",
      });
      const readySelection = await selectReadyTasks({ rootDir });

      expect(showModel.dependencies).toEqual([]);
      expect(showModel.relationships).toBeUndefined();
      expect(showModel.records).toBeUndefined();
      expect(showModel.activeLocks).toBeUndefined();

      expect(promptModel.dependencies).toEqual([]);
      expect(promptModel.relationships).toBeUndefined();
      expect(promptModel.records).toBeUndefined();
      expect(promptModel.activeLocks).toBeUndefined();

      expect(readySelection.candidates.map((candidate) => candidate.id)).toEqual([
        "wi-300",
      ]);
      expect(
        readySelection.exclusions.map((entry) => ({
          id: entry.id,
          codes: entry.reasons.map((reason) => reason.code),
        })),
      ).toEqual([{ id: "wi-301", codes: ["blocked", "not_ready"] }]);
    });
  });

  it("keeps lifecycle transitions on canonical document state without projecting the work graph", async () => {
    await withTmpRoot(async (rootDir) => {
      await writeTask(
        rootDir,
        "302-transition-source.md",
        `id: wi-302
title: Transition Source
type: work-item
lifecycle: active
status: ready
status_reason: auto
tags:
  - afk`,
        "## Acceptance Criteria\n\n- [x] Do the thing\n",
      );

      const projectSpy = vi.spyOn(projectionModule, "projectWorkGraph");
      const claim = await claimTask("wi-302", {
        rootDir,
        claimStorePath: claimStorePath(rootDir),
        holder: "agent-a",
      });
      const transition = await transitionTask({
        rootDir,
        claimStorePath: claimStorePath(rootDir),
        claimId: claim.claimId,
        status: "running",
        statusReason: "implementation",
      });

      expect(transition).toMatchObject({
        taskId: "wi-302",
        fromStatus: "ready",
        toStatus: "running",
        matchedRuleId: "forward-ready-to-running",
      });
      expect(projectSpy).not.toHaveBeenCalled();
      expect(
        await fs.readFile(
          path.join(rootDir, "backlog", "302-transition-source.md"),
          "utf8",
        ),
      ).toContain("status: running");
    });
  });
});
