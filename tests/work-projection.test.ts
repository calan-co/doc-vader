import { afterEach, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { openRuntimeSqliteStore, RUNTIME_SCHEMA_VERSION } from "../lib/runtime/index.js";
import {
  projectWorkGraph,
  type WorkGraphProjection,
} from "../lib/work/index.js";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

const tempDirs: string[] = [];

async function createTempRepo(): Promise<string> {
  const dir = path.join(os.tmpdir(), `doc-vader-work-projection-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

async function writeMarkdown(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

function createRuntimeClaim(rootDir: string): void {
  const store = openRuntimeSqliteStore({ rootDir });
  try {
    const seed = {
      schema_version: RUNTIME_SCHEMA_VERSION,
      target_type: "task",
      target_id: "wi-60386",
      holder: "agent-a",
      created_at: new Date("2026-06-25T00:00:00.000Z").toISOString(),
      expires_at: new Date("2026-06-25T01:00:00.000Z").toISOString(),
      entropy: randomUUID(),
    } as const;
    const result = store.acquireRuntimeClaim(seed, { initialLockPaths: [] });
    expect(result.outcome).toBe("acquired");
  } finally {
    store.close();
  }
}

async function buildProjection(rootDir: string): Promise<WorkGraphProjection> {
  return projectWorkGraph({
    rootDir,
    workspaceDirs: ["backlog", "docs"],
  });
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) =>
      rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe("work projection port", () => {
  it("projects stable nodes, authored edges, and derived reverse traversal", async () => {
    const rootDir = await createTempRepo();
    await writeMarkdown(
      path.join(rootDir, "backlog", "60386-projection-port-tracer.md"),
      `---
id: wi-60386
title: Projection Port Tracer
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: high
links:
  depends_on:
    - '[[wi-60384]]'
---

## Goal

Track the first graph-aligned projection port.

## Relationships

- \`part_of\`: [[project-projection-graph]]
- \`implements\`: [[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]
- \`depends_on\`: [[wi-60384]]
- \`blocks\`: [[wi-99999]]
- \`relates_to\`: [[wi-88888]]
`,
    );
    await writeMarkdown(
      path.join(rootDir, "backlog", "60384-work-command-surface-and-scoperef-canonicalization.md"),
      `---
id: wi-60384
title: Work Command Surface And ScopeRef Canonicalization
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
---

## Goal

Canonicalize work item scope refs.
`,
    );
    await writeMarkdown(
      path.join(
        rootDir,
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

Define the Work + Claim + Scope MVP.
`,
    );
    await writeMarkdown(
      path.join(rootDir, "docs", "project-projection-graph.md"),
      `---
id: project:projection-graph
title: Projection Graph
type: project
subtype: initiative
lifecycle: active
status: ready
---

## Goal

Track the projection graph target.
`,
    );
    await writeMarkdown(
      path.join(rootDir, "backlog", "records", "record-projection-note.md"),
      `---
id: record:projection-note
title: Projection Note
type: record
subtype: evidence
lifecycle: active
status: ready
---

## Observation

Projection remains deterministic.
`,
    );

    createRuntimeClaim(rootDir);

    const projection = await buildProjection(rootDir);
    const secondProjection = await buildProjection(rootDir);

    expect(secondProjection.nodes).toEqual(projection.nodes);
    expect(secondProjection.edges).toEqual(projection.edges);

    const workItem = projection.findNode("wi:60386");
    const dependency = projection.findNode("wi:60384");
    const projectScope = projection.findNode("scope:project:projection-graph");
    const prdScope = projection.findNode(
      "scope:plan:doc-vader-work-item-claim-scope-mvp-prd",
    );
    const claim = projection.findNode(
      projection.getNodesByType("claim")[0]?.id ?? "",
    );
    const claimScope = projection.findNode(
      projection.getNodesByType("scope").find((node) =>
        node.id.startsWith("scope:wi:60386"),
      )?.id ?? "",
    );

    expect(workItem?.type).toBe("work-item");
    expect(dependency?.type).toBe("work-item");
    expect(projectScope?.type).toBe("scope");
    expect(prdScope?.type).toBe("scope");
    expect(claim?.type).toBe("claim");
    expect(claimScope?.type).toBe("scope");

    const dependsOn = projection
      .getOutgoingEdges("wi:60386")
      .filter((edge) => edge.type === "depends_on");
    expect(dependsOn).toHaveLength(1);
    expect(dependsOn[0]?.from).toBe("wi:60386");
    expect(dependsOn[0]?.to).toBe("wi:60384");
    expect(dependsOn[0]?.direction).toBe("authored");

    const incomingToDependency = projection.getIncomingEdges("wi:60384");
    expect(incomingToDependency.map((edge) => edge.type)).toEqual(["depends_on"]);

    const belongsTo = projection
      .getOutgoingEdges("wi:60386")
      .filter((edge) => edge.type === "belongs_to");
    expect(belongsTo).toHaveLength(1);
    expect(belongsTo[0]?.to).toBe("scope:project:projection-graph");

    const implementsEdges = projection
      .getOutgoingEdges("wi:60386")
      .filter((edge) => edge.type === "implements");
    expect(implementsEdges).toHaveLength(1);
    expect(implementsEdges[0]?.to).toBe(
      "scope:plan:doc-vader-work-item-claim-scope-mvp-prd",
    );

    expect(
      projection.edges.some(
        (edge) => edge.type === "blocks" || edge.type === "relates_to",
      ),
    ).toBe(false);

    expect(
      projection.getNodesByType("scope").some((node) => node.id === "scope:wi:60386"),
    ).toBe(true);
    expect(
      projection.getNodesByType("record").some(
        (node) => node.id === "record:projection-note",
      ),
    ).toBe(true);
  });

  it("projects active claim scope locks as authored claim-to-scope lock edges", async () => {
    const rootDir = await createTempRepo();
    await writeMarkdown(
      path.join(rootDir, "backlog", "60387-claim-lock-graph-projection.md"),
      `---
id: wi-60387
title: Claim Lock Graph Projection
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
---

## Goal

Project claim scope locks into graph edges.
`,
    );

    const store = openRuntimeSqliteStore({ rootDir });
    try {
      const executeClaim = store.acquireRuntimeClaim({
        schema_version: RUNTIME_SCHEMA_VERSION,
        target_type: "task",
        target_id: "wi-60387",
        holder: "agent-execute",
        created_at: "2099-06-25T00:00:00.000Z",
        expires_at: "2099-06-25T01:00:00.000Z",
        entropy: "claim-execute",
      });
      const readClaim = store.acquireRuntimeClaim({
        schema_version: RUNTIME_SCHEMA_VERSION,
        target_type: "document",
        target_id: "doc:claim-lock-read",
        holder: "agent-read",
        created_at: "2099-06-25T00:05:00.000Z",
        expires_at: "2099-06-25T01:05:00.000Z",
        entropy: "claim-read",
      });
      const writeClaim = store.acquireRuntimeClaim({
        schema_version: RUNTIME_SCHEMA_VERSION,
        target_type: "document",
        target_id: "doc:claim-lock-write",
        holder: "agent-write",
        created_at: "2099-06-25T00:10:00.000Z",
        expires_at: "2099-06-25T01:10:00.000Z",
        entropy: "claim-write",
      });

      for (const claim of [executeClaim, readClaim, writeClaim]) {
        expect(claim.outcome).toBe("acquired");
      }

      if (
        executeClaim.outcome !== "acquired" ||
        readClaim.outcome !== "acquired" ||
        writeClaim.outcome !== "acquired"
      ) {
        throw new Error("Expected all scope-lock projection claims to be acquired.");
      }

      expect(
        store.acquireRuntimeScopeLocks(readClaim.claimToken, [
          { scopeRef: "wi-60387", lockMode: "read" },
        ]),
      ).toMatchObject({ outcome: "acquired" });
      expect(
        store.acquireRuntimeScopeLocks(writeClaim.claimToken, [
          { scopeRef: "doc:claim-lock-spec", lockMode: "write" },
        ]),
      ).toMatchObject({ outcome: "acquired" });
    } finally {
      store.close();
    }

    const projection = await buildProjection(rootDir);
    const lockEdges = projection.getEdgesByType("locks");

    expect(lockEdges).toHaveLength(5);
    expect(lockEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "locks",
          from: expect.stringMatching(/^claim:/),
          to: "scope:doc:claim-lock-spec",
          direction: "authored",
          properties: expect.objectContaining({
            claimToken: expect.any(String),
            scopeRef: "doc:claim-lock-spec",
            lockMode: "write",
            policyName: "WriteLockPolicy",
            lifecycleState: "active",
            acquiredAt: expect.any(String),
            updatedAt: expect.any(String),
            targetType: "document",
            targetId: "doc:claim-lock-write",
            claimState: "active",
          }),
        }),
        expect.objectContaining({
          type: "locks",
          from: expect.stringMatching(/^claim:/),
          to: "scope:wi:60387",
          direction: "authored",
          properties: expect.objectContaining({
            scopeRef: "wi:60387",
            lockMode: "execute",
            policyName: "ExecuteLockPolicy",
            lifecycleState: "active",
          }),
        }),
        expect.objectContaining({
          type: "locks",
          from: expect.stringMatching(/^claim:/),
          to: "scope:wi:60387",
          direction: "authored",
          properties: expect.objectContaining({
            scopeRef: "wi:60387",
            lockMode: "read",
            policyName: "ReadLockPolicy",
            lifecycleState: "active",
            targetId: "doc:claim-lock-read",
          }),
        }),
        expect.objectContaining({
          type: "locks",
          from: expect.stringMatching(/^claim:/),
          to: "scope:doc:claim-lock-read",
          direction: "authored",
          properties: expect.objectContaining({
            scopeRef: "doc:claim-lock-read",
            lockMode: "execute",
            policyName: "ExecuteLockPolicy",
            lifecycleState: "active",
          }),
        }),
        expect.objectContaining({
          type: "locks",
          from: expect.stringMatching(/^claim:/),
          to: "scope:doc:claim-lock-write",
          direction: "authored",
          properties: expect.objectContaining({
            scopeRef: "doc:claim-lock-write",
            lockMode: "execute",
            policyName: "ExecuteLockPolicy",
            lifecycleState: "active",
          }),
        }),
      ]),
    );

    expect(projection.findNode("scope:doc:claim-lock-spec")?.type).toBe("scope");
    expect(projection.findNode("scope:wi:60387")?.type).toBe("scope");
  });
});
