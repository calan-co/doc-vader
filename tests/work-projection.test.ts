import { afterEach, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import {
  openRuntimeSqliteStore,
  RUNTIME_SCHEMA_VERSION,
  type RuntimeInitialClaimAcquisitionResult,
} from "../lib/runtime/index.js";
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

function expectAcquiredClaim(
  result: RuntimeInitialClaimAcquisitionResult,
  description: string,
) {
  expect(result.outcome).toBe("acquired");
  if (result.outcome !== "acquired") {
    throw new Error(`Expected ${description} claim to be acquired.`);
  }
  return result;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) =>
      rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe("work projection port", () => {
  it("classifies helper documents with non-canonical generic ids without failing live projection", async () => {
    const rootDir = await createTempRepo();
    await writeMarkdown(
      path.join(rootDir, "backlog", "AGENTS.md"),
      `---
id: backloga-2056
title: Backlog Agents Policy
type: document
subtype: generic
lifecycle: evergreen
status: closed
---

Helper policy document that is not an MVP graph node.
`,
    );
    await writeMarkdown(
      path.join(rootDir, "backlog", "60392-live-repository-graph-projection-robustness.md"),
      `---
id: wi-60392
title: Live Repository Graph Projection Robustness
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
---

## Goal

Keep live repository projection robust.
`,
    );

    const projection = await buildProjection(rootDir);

    expect(projection.findNode("wi:60392")?.type).toBe("work-item");
    expect(projection.findNode("scope:wi:60392")?.type).toBe("scope");
    expect(projection.diagnostics).toEqual([
      {
        classification: "unsupported",
        relativePath: "backlog/AGENTS.md",
        documentId: "backloga-2056",
        reasonCode: "unsupported-document-type",
      },
    ]);
  });

  it("projects parent frontmatter links as parentage edges", async () => {
    const rootDir = await createTempRepo();
    await writeMarkdown(
      path.join(rootDir, "backlog", "101-child.md"),
      `---
id: wi-101
title: Child Work
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
links:
  parent:
    - '[[project-parent]]'
---

## Goal

Exercise parent links.
`,
    );
    await writeMarkdown(
      path.join(rootDir, "docs", "project-parent.md"),
      `---
id: project:parent
title: Parent Project
type: project
subtype: initiative
lifecycle: active
status: ready
---

## Goal

Group child work.
`,
    );

    const projection = await buildProjection(rootDir);

    expect(projection.getOutgoingEdges("wi:101")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "belongs_to",
          authority: "formal",
          from: "wi:101",
          to: "scope:project:parent",
          source: expect.objectContaining({ kind: "frontmatter" }),
          properties: expect.objectContaining({
            sourceKey: "parent",
            rawTarget: "[[project-parent]]",
            resolvedTargetId: "scope:project:parent",
          }),
        }),
      ]),
    );
  });

  it("reports project-like documents with non-canonical scope ids as unsupported diagnostics", async () => {
    const rootDir = await createTempRepo();
    await writeMarkdown(
      path.join(rootDir, "docs", "how-to", "implementation-plans", "example-prd.md"),
      `---
id: prd-example
title: Example PRD
type: prd
subtype: x-prd
lifecycle: active
status: ready
---

## Goal

Exercise non-canonical project-like ids.
`,
    );
    await writeMarkdown(
      path.join(rootDir, "backlog", "60392-live-repository-graph-projection-robustness.md"),
      `---
id: wi-60392
title: Live Repository Graph Projection Robustness
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
---

## Goal

Keep live repository projection robust.

## Relationships

- \`implements\`: [[../docs/how-to/implementation-plans/example-prd.md]]
`,
    );

    const projection = await buildProjection(rootDir);

    expect(projection.findNode("wi:60392")?.type).toBe("work-item");
    expect(projection.getEdgesByType("implements")).toEqual([]);
    expect(projection.diagnostics).toEqual([
      {
        classification: "unsupported",
        relativePath: "docs/how-to/implementation-plans/example-prd.md",
        documentId: "prd-example",
        reasonCode: "non-canonical-document-id",
      },
    ]);
  });

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
    - '[[wi-60384]]'
  evidence:
    - '[[records/record-projection-note.md]]'
  part_of:
    - '[[project-projection-graph]]'
  implements:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]'
---

## Goal

Track the first graph-aligned projection port.
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
    expect(dependsOn).toHaveLength(2);
    expect(dependsOn).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "wi:60386::depends_on::wi:60384::frontmatter::backlog/60386-projection-port-tracer.md::depends_on::[[wi-60384]]",
          from: "wi:60386",
          to: "wi:60384",
          direction: "authored",
          source: expect.objectContaining({ kind: "frontmatter" }),
        }),
        expect.objectContaining({
          id: "wi:60386::depends_on::wi:60384",
          from: "wi:60386",
          to: "wi:60384",
          direction: "authored",
          source: expect.objectContaining({ kind: "frontmatter" }),
        }),
      ]),
    );

    const incomingToDependency = projection.getIncomingEdges("wi:60384");
    expect(incomingToDependency.map((edge) => edge.type)).toEqual([
      "depends_on",
      "depends_on",
    ]);

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
    expect(projection.getEdgesByType("records")).toEqual([
      expect.objectContaining({
        from: "record:projection-note",
        to: "wi:60386",
        type: "records",
        properties: expect.objectContaining({
          recordKind: "evidence",
        }),
      }),
    ]);
  });

  it("surfaces runtime sqlite read failures when the runtime database exists", async () => {
    const rootDir = await createTempRepo();
    await mkdir(path.join(rootDir, ".doc-vader", "runtime"), {
      recursive: true,
    });
    await writeFile(
      path.join(rootDir, ".doc-vader", "runtime", "runtime.sqlite"),
      "not a sqlite database",
      "utf8",
    );

    await expect(buildProjection(rootDir)).rejects.toThrow();
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
      const executeClaim = expectAcquiredClaim(
        store.acquireRuntimeClaim({
          schema_version: RUNTIME_SCHEMA_VERSION,
          target_type: "task",
          target_id: "wi-60387",
          holder: "agent-execute",
          created_at: "2099-06-25T00:00:00.000Z",
          expires_at: "2099-06-25T01:00:00.000Z",
          entropy: "claim-execute",
        }),
        "execute scope-lock projection",
      );
      const readClaim = expectAcquiredClaim(
        store.acquireRuntimeClaim({
          schema_version: RUNTIME_SCHEMA_VERSION,
          target_type: "document",
          target_id: "doc:claim-lock-read",
          holder: "agent-read",
          created_at: "2099-06-25T00:05:00.000Z",
          expires_at: "2099-06-25T01:05:00.000Z",
          entropy: "claim-read",
        }),
        "read scope-lock projection",
      );
      const writeClaim = expectAcquiredClaim(
        store.acquireRuntimeClaim({
          schema_version: RUNTIME_SCHEMA_VERSION,
          target_type: "document",
          target_id: "doc:claim-lock-write",
          holder: "agent-write",
          created_at: "2099-06-25T00:10:00.000Z",
          expires_at: "2099-06-25T01:10:00.000Z",
          entropy: "claim-write",
        }),
        "write scope-lock projection",
      );

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

  it("projects record lineage edges to work items, claims, and scopes in deterministic order", async () => {
    const rootDir = await createTempRepo();
    await writeMarkdown(
      path.join(rootDir, "backlog", "60390-record-edges-and-audit-lineage.md"),
      `---
id: wi-60390
title: Record Edges And Audit Lineage
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
links:
  evidence:
    - '[[records/record-claim-scope-audit.md]]'
---

## Goal

Project record edges for audit lineage.
`,
    );

    const store = openRuntimeSqliteStore({ rootDir });
    let claimToken = "";
    try {
      const claim = expectAcquiredClaim(
        store.acquireRuntimeClaim({
          schema_version: RUNTIME_SCHEMA_VERSION,
          target_type: "task",
          target_id: "wi-60390",
          holder: "agent-lineage",
          created_at: "2099-06-26T00:00:00.000Z",
          expires_at: "2099-06-26T01:00:00.000Z",
          entropy: "claim-lineage",
        }),
        "record-lineage projection",
      );
      claimToken = claim.claimToken;

      expect(
        store.acquireRuntimeScopeLocks(claimToken, [
          { scopeRef: "wi-60391", lockMode: "write" },
        ]),
      ).toMatchObject({ outcome: "acquired" });
    } finally {
      store.close();
    }

    await writeMarkdown(
      path.join(rootDir, "backlog", "records", "record-claim-scope-audit.md"),
      `---
id: record:claim-scope-audit
title: Claim Scope Audit
summary: Claim scope audit lineage
type: record
subtype: audit-note
lifecycle: active
status: ready
status_reason: recorded
links:
  subjects:
    - "[[60390-record-edges-and-audit-lineage]]"
    - "claim:${claimToken}"
    - "wi:60390"
    - "wi:60391"
---

## Observation

Projected lineage stays queryable.
`,
    );

    const projection = await buildProjection(rootDir);
    const recordEdges = projection.getEdgesByType("records");

    expect(recordEdges).toHaveLength(5);
    expect(recordEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `record:claim-scope-audit::records::claim:${claimToken}`,
          type: "records",
          from: "record:claim-scope-audit",
          to: `claim:${claimToken}`,
          direction: "authored",
          properties: expect.objectContaining({
            recordKind: "audit-note",
            subject: `claim:${claimToken}`,
          }),
        }),
        expect.objectContaining({
          id: "record:claim-scope-audit::records::scope:wi:60390",
          type: "records",
          from: "record:claim-scope-audit",
          to: "scope:wi:60390",
          direction: "authored",
          properties: expect.objectContaining({
            recordKind: "audit-note",
            subject: "wi:60390",
          }),
        }),
        expect.objectContaining({
          id: "record:claim-scope-audit::records::scope:wi:60391",
          type: "records",
          from: "record:claim-scope-audit",
          to: "scope:wi:60391",
          direction: "authored",
          properties: expect.objectContaining({
            recordKind: "audit-note",
            subject: "wi:60391",
          }),
        }),
        expect.objectContaining({
          type: "records",
          from: "record:claim-scope-audit",
          to: "wi:60390",
          direction: "authored",
          source: expect.objectContaining({ kind: "frontmatter" }),
        }),
        expect.objectContaining({
          type: "records",
          from: "record:claim-scope-audit",
          to: "wi:60390",
          direction: "authored",
          source: expect.objectContaining({ kind: "frontmatter" }),
          properties: expect.objectContaining({
            recordKind: "audit-note",
            subject: "[[records/record-claim-scope-audit.md]]",
          }),
        }),
      ]),
    );
  });
});
