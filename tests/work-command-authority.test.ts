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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("immutable work command authority gate", () => {
  it("ignores informational governance-like edges for show, prompt, and ready", async () => {
    const rootDir = await mkTmpRoot();
    try {
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

      const sourceNode: WorkGraphNode = {
        id: "wi:300",
        type: "work-item",
        stableId: "wi:300",
        label: "Authority Source",
        source: {
          kind: "work-item",
          filePath: "backlog/300-authority-source.md",
        },
        properties: {
          frontmatterId: "wi-300",
          status: "ready",
          lifecycle: "active",
        },
      };
      const targetNode: WorkGraphNode = {
        id: "wi:301",
        type: "work-item",
        stableId: "wi:301",
        label: "Authority Target",
        source: {
          kind: "work-item",
          filePath: "backlog/301-authority-target.md",
        },
        properties: {
          frontmatterId: "wi-301",
          status: "blocked",
          lifecycle: "active",
        },
      };
      const projection = createProjection({
        nodes: [sourceNode, targetNode],
        edges: [
          {
            id: "wi:300::depends_on::wi:301",
            type: "depends_on",
            authority: "informational",
            from: "wi:300",
            to: "wi:301",
            direction: "authored",
            source: {
              kind: "relationships",
              filePath: "backlog/300-authority-source.md",
            },
            properties: {
              sourceKey: "reference",
              rawTarget: "[[wi-301]]",
              resolvedTargetId: "wi:301",
            },
          },
          {
            id: "wi:300::belongs_to::scope:project:shadow",
            type: "belongs_to",
            authority: "informational",
            from: "wi:300",
            to: "scope:project:shadow",
            direction: "authored",
            source: {
              kind: "relationships",
              filePath: "backlog/300-authority-source.md",
            },
            properties: {
              sourceKey: "reference",
              rawTarget: "[[project:shadow]]",
              resolvedTargetId: "scope:project:shadow",
            },
          },
          {
            id: "wi:300::implements::scope:plan:shadow-prd",
            type: "implements",
            authority: "informational",
            from: "wi:300",
            to: "scope:plan:shadow-prd",
            direction: "authored",
            source: {
              kind: "relationships",
              filePath: "backlog/300-authority-source.md",
            },
            properties: {
              sourceKey: "reference",
              rawTarget: "[[../docs/how-to/implementation-plans/shadow-prd.md]]",
              resolvedTargetId: "scope:plan:shadow-prd",
            },
          },
          {
            id: "record:shadow::records::wi:300",
            type: "records",
            authority: "informational",
            from: "record:shadow",
            to: "wi:300",
            direction: "authored",
            source: {
              kind: "runtime",
            },
            properties: {
              sourceKey: "reference",
              rawTarget: "[[records/shadow]]",
              resolvedTargetId: "record:shadow",
            },
          },
          {
            id: "claim:shadow::locks::scope:wi:300",
            type: "locks",
            authority: "informational",
            from: "claim:shadow",
            to: "scope:wi:300",
            direction: "authored",
            source: {
              kind: "runtime",
              claimToken: "claim:shadow",
            },
            properties: {
              claimToken: "claim:shadow",
              scopeRef: "wi:300",
              lockMode: "execute",
            },
          },
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
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("keeps lifecycle transitions on canonical document state without projecting the work graph", async () => {
    const rootDir = await mkTmpRoot();
    try {
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
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
