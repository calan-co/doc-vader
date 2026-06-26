import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  adaptWorkGraphExportToCytoscape,
  exportWorkGraph,
  findWorkGraphPathTrace,
  getWorkGraphNeighborhood,
  projectWorkGraph,
  renderStandaloneWorkGraphViewer,
} from "../lib/work/index.js";
import { stageWorkGraphUacFixture } from "./helpers/work-graph-uac-fixture";

const tempDirs: string[] = [];

async function createTempRoot(): Promise<string> {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "doc-vader-work-graph-visualization-"),
  );
  tempDirs.push(rootDir);
  return rootDir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) =>
      rm(dir, { recursive: true, force: true }),
    ),
  );
});

const syntheticGraph = {
  schemaVersion: "work-graph-explorer/v1",
  sourceCommand: "export",
  summary: {
    nodeCount: 4,
    edgeCount: 3,
    diagnosticCount: 0,
    nodeTypes: [{ type: "work-item", count: 4 }],
    edgeTypes: [{ type: "depends_on", count: 3 }],
  },
  diagnostics: [],
  elements: [
    {
      group: "nodes" as const,
      data: {
        id: "a",
        label: "Node A",
        stableId: "a",
        nodeType: "work-item" as const,
        provenance: { kind: "work-item" as const, filePath: "backlog/a.md" },
        properties: {},
        filePath: "backlog/a.md",
        searchText: "a node a backlog/a.md",
      },
    },
    {
      group: "nodes" as const,
      data: {
        id: "b",
        label: "Node B",
        stableId: "b",
        nodeType: "work-item" as const,
        provenance: { kind: "work-item" as const, filePath: "backlog/b.md" },
        properties: {},
        filePath: "backlog/b.md",
        searchText: "b node b backlog/b.md",
      },
    },
    {
      group: "nodes" as const,
      data: {
        id: "c",
        label: "Node C",
        stableId: "c",
        nodeType: "work-item" as const,
        provenance: { kind: "work-item" as const, filePath: "backlog/c.md" },
        properties: {},
        filePath: "backlog/c.md",
        searchText: "c node c backlog/c.md",
      },
    },
    {
      group: "nodes" as const,
      data: {
        id: "d",
        label: "Node D",
        stableId: "d",
        nodeType: "work-item" as const,
        provenance: { kind: "work-item" as const, filePath: "backlog/d.md" },
        properties: {},
        filePath: "backlog/d.md",
        searchText: "d node d backlog/d.md",
      },
    },
    {
      group: "edges" as const,
      data: {
        id: "a->b",
        source: "a",
        target: "b",
        label: "depends_on",
        stableId: "a->b",
        edgeType: "depends_on" as const,
        authority: "formal" as const,
        sourceKey: "depends_on",
        rawTarget: "[[b]]",
        resolvedTargetId: "b",
        direction: "authored" as const,
        provenance: { kind: "relationships" as const, filePath: "backlog/a.md" },
        properties: {},
        filePath: "backlog/a.md",
        searchText: "a->b depends_on backlog/a.md",
      },
    },
    {
      group: "edges" as const,
      data: {
        id: "c->a",
        source: "c",
        target: "a",
        label: "depends_on",
        stableId: "c->a",
        edgeType: "depends_on" as const,
        authority: "informational" as const,
        sourceKey: "depends_on_typo",
        rawTarget: "[[a]]",
        resolvedTargetId: "a",
        direction: "authored" as const,
        provenance: { kind: "relationships" as const, filePath: "backlog/c.md" },
        properties: {},
        filePath: "backlog/c.md",
        searchText: "c->a depends_on backlog/c.md",
      },
    },
    {
      group: "edges" as const,
      data: {
        id: "b->d",
        source: "b",
        target: "d",
        label: "depends_on",
        stableId: "b->d",
        edgeType: "depends_on" as const,
        authority: "formal" as const,
        sourceKey: "depends_on",
        rawTarget: "[[d]]",
        resolvedTargetId: "d",
        direction: "authored" as const,
        provenance: { kind: "relationships" as const, filePath: "backlog/b.md" },
        properties: {},
        filePath: "backlog/b.md",
        searchText: "b->d depends_on backlog/b.md",
      },
    },
  ],
};

describe("work graph visualization", () => {
  it("computes one-hop traversal neighborhoods and directed path traces without mutating graph facts", () => {
    const before = JSON.parse(JSON.stringify(syntheticGraph));

    expect(getWorkGraphNeighborhood(syntheticGraph, "a", "incoming")).toEqual({
      centerNodeId: "a",
      direction: "incoming",
      nodeIds: ["a", "c"],
      edgeIds: ["c->a"],
    });
    expect(getWorkGraphNeighborhood(syntheticGraph, "a", "outgoing")).toEqual({
      centerNodeId: "a",
      direction: "outgoing",
      nodeIds: ["a", "b"],
      edgeIds: ["a->b"],
    });
    expect(getWorkGraphNeighborhood(syntheticGraph, "a", "both")).toEqual({
      centerNodeId: "a",
      direction: "both",
      nodeIds: ["a", "b", "c"],
      edgeIds: ["a->b", "c->a"],
    });

    expect(findWorkGraphPathTrace(syntheticGraph, "c", "d")).toEqual({
      startNodeId: "c",
      endNodeId: "d",
      found: true,
      nodeIds: ["c", "a", "b", "d"],
      edgeIds: ["c->a", "a->b", "b->d"],
    });
    expect(findWorkGraphPathTrace(syntheticGraph, "d", "c")).toEqual({
      startNodeId: "d",
      endNodeId: "c",
      found: false,
      nodeIds: [],
      edgeIds: [],
    });
    expect(syntheticGraph).toEqual(before);
  });

  it("adapts canonical export JSON into non-canonical Cytoscape elements", async () => {
    const rootDir = await createTempRoot();
    await stageWorkGraphUacFixture(rootDir);

    const projection = await projectWorkGraph({ rootDir });
    const canonicalExport = exportWorkGraph(projection);
    const adapted = adaptWorkGraphExportToCytoscape(canonicalExport);

    expect(adapted.schemaVersion).toBe("work-graph-explorer/v1");
    expect(adapted.sourceCommand).toBe("export");
    expect(adapted.elements).toHaveLength(
      canonicalExport.nodes.length + canonicalExport.edges.length,
    );
    expect(adapted.diagnostics).toEqual(canonicalExport.diagnostics);

    const mainNode = adapted.elements.find(
      (element) =>
        element.group === "nodes" && element.data.id === "wi:70001",
    );
    expect(mainNode).toMatchObject({
      group: "nodes",
      data: {
        id: "wi:70001",
        label: "Work Graph UAC Review Main",
        stableId: "wi:70001",
        nodeType: "work-item",
        provenance: {
          kind: "work-item",
          filePath: "backlog/70001-work-graph-uac-main.md",
        },
      },
    });

    const dependencyEdge = adapted.elements.find(
      (element) =>
        element.group === "edges" &&
        element.data.id === "wi:70001::depends_on::wi:70002",
    );
    expect(dependencyEdge).toMatchObject({
      group: "edges",
      data: {
        id: "wi:70001::depends_on::wi:70002",
        source: "wi:70001",
        target: "wi:70002",
        label: "depends_on",
        stableId: "wi:70001::depends_on::wi:70002",
        edgeType: "depends_on",
        authority: "formal",
        sourceKey: "depends_on",
        rawTarget: "[[wi-70002]]",
        resolvedTargetId: "wi:70002",
        provenance: {
          kind: "relationships",
          filePath: "backlog/70001-work-graph-uac-main.md",
        },
      },
    });
  });

  it("renders a standalone HTML artifact that embeds adapted graph data", async () => {
    const rootDir = await createTempRoot();
    await stageWorkGraphUacFixture(rootDir);

    const projection = await projectWorkGraph({ rootDir });
    const html = renderStandaloneWorkGraphViewer(
      adaptWorkGraphExportToCytoscape(exportWorkGraph(projection)),
    );

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Work Graph Viewer");
    expect(html).toContain("Standalone Artifact");
    expect(html).toContain("https://unpkg.com/cytoscape@3.33.1/dist/cytoscape.min.js");
    expect(html).toContain("Overview");
    expect(html).toContain('for="graph-search"');
    expect(html).toContain("Search by stable id, label, or source file");
    expect(html).toContain('id="node-type-filters"');
    expect(html).toContain('id="edge-type-filters"');
    expect(html).toContain('id="traversal-incoming"');
    expect(html).toContain('id="traversal-outgoing"');
    expect(html).toContain('id="focus-neighborhood"');
    expect(html).toContain('id="clear-focus"');
    expect(html).toContain('id="path-start"');
    expect(html).toContain('id="path-end"');
    expect(html).toContain('id="trace-path"');
    expect(html).toContain('id="clear-path"');
    expect(html).toContain("No directed path found");
    expect(html).toContain('id="inspection-panel"');
    expect(html).toContain("Select a node or edge to inspect its stable metadata.");
    expect(html).toContain("Diagnostics Context");
    expect(html).toContain('edge[authority = "informational"]');
    expect(html).toContain('"authority":"formal"');
    expect(html).toContain('"sourceKey":"depends_on"');
    expect(html).toContain('"resolvedTargetId":"wi:70002"');
    expect(html).toContain('"searchText":"wi:70001 work graph uac review main backlog/70001-work-graph-uac-main.md"');
    expect(html).toContain('"filePath":"backlog/70001-work-graph-uac-main.md"');
    expect(html).toContain('"id":"wi:70001"');
    expect(html).toContain('"relativePath":"backlog/AGENTS.md"');
  });
});
