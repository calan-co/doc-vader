import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  adaptWorkGraphExportToCytoscape,
  exportWorkGraph,
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

describe("work graph visualization", () => {
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
    expect(html).toContain("Diagnostics are preserved outside Cytoscape elements.");
    expect(html).toContain('"id":"wi:70001"');
    expect(html).toContain('"relativePath":"backlog/AGENTS.md"');
  });
});
