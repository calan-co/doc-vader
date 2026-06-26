import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  stageWorkGraphUacFixture,
  workGraphUacExpectedDir,
} from "./helpers/work-graph-uac-fixture";

const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const cliPath = path.resolve(__dirname, "../cli/doc-vader.ts");

const tempDirs: string[] = [];

type WorkGraphExportPayload = {
  schemaVersion: string;
  command: string;
  summary: {
    nodeCount: number;
    edgeCount: number;
    diagnosticCount: number;
    nodeTypes: Array<{ type: string; count: number }>;
    edgeTypes: Array<{ type: string; count: number }>;
  };
  nodes: Array<{ id: string; type: string }>;
  edges: Array<{ type: string }>;
  diagnostics: Array<{
    classification: string;
    relativePath: string;
    documentId: string;
    reasonCode: string;
  }>;
};

async function createTempRoot(): Promise<string> {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), `doc-vader-work-graph-uac-${randomUUID()}-`),
  );
  tempDirs.push(rootDir);
  return rootDir;
}

async function snapshotFiles(rootDir: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      const relativePath = path.relative(rootDir, entryPath);
      snapshot.set(relativePath, await readFile(entryPath, "utf8"));
    }
  }

  await walk(rootDir);
  return snapshot;
}

function runCli(rootDir: string, args: string[]): string {
  return execFileSync(process.execPath, ["--import", tsxImport, cliPath, ...args], {
    cwd: rootDir,
    encoding: "utf8",
  });
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) =>
      rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe("work graph UAC review fixture", () => {
  it("stages the documented review fixture with stable JSON and DOT outputs", async () => {
    const rootDir = await createTempRoot();
    await mkdir(rootDir, { recursive: true });

    await stageWorkGraphUacFixture(rootDir);
    const before = await snapshotFiles(rootDir);

    const nodes = runCli(rootDir, ["work", "graph", "nodes", "--format", "json"]);
    const edges = runCli(rootDir, ["work", "graph", "edges", "--format", "json"]);
    const summary = runCli(rootDir, ["work", "graph", "summary"]);
    const exportJson = runCli(rootDir, ["work", "graph", "export", "--format", "json"]);
    const exportDot = runCli(rootDir, ["work", "graph", "export", "--format", "dot"]);
    const inspect = runCli(rootDir, [
      "work",
      "graph",
      "inspect",
      "wi:70001",
      "--format",
      "json",
    ]);
    const dot = runCli(rootDir, [
      "work",
      "graph",
      "inspect",
      "wi:70001",
      "--format",
      "dot",
    ]);

    expect(nodes).toBe(
      await readFile(path.join(workGraphUacExpectedDir, "nodes.json"), "utf8"),
    );
    expect(edges).toBe(
      await readFile(path.join(workGraphUacExpectedDir, "edges.json"), "utf8"),
    );
    expect(summary).toBe(
      [
        "Work Graph Summary",
        "Nodes\t4 scope, 2 work-item, 1 claim, 1 record",
        "Edges\t3 records, 2 belongs_to, 2 locks, 1 depends_on, 1 implements",
        "Diagnostics\t1",
        "Totals\t8 nodes, 9 edges",
        "",
      ].join("\n"),
    );
    expect(inspect).toBe(
      await readFile(path.join(workGraphUacExpectedDir, "inspect-wi-70001.json"), "utf8"),
    );
    expect(dot).toBe(
      await readFile(path.join(workGraphUacExpectedDir, "inspect-wi-70001.dot"), "utf8"),
    );
    expect(exportDot.startsWith("digraph WorkGraph {\n")).toBe(true);

    const parsedNodes = JSON.parse(nodes) as {
      nodes: Array<{ type: string }>;
    };
    const parsedEdges = JSON.parse(edges) as {
      edges: Array<{ type: string }>;
    };
    const parsedExport = JSON.parse(exportJson) as WorkGraphExportPayload;

    expect(new Set(parsedNodes.nodes.map((node) => node.type))).toEqual(
      new Set(["work-item", "claim", "record", "scope"]),
    );
    expect(new Set(parsedEdges.edges.map((edge) => edge.type))).toEqual(
      new Set(["depends_on", "belongs_to", "implements", "locks", "records"]),
    );
    expect(parsedEdges.edges.some((edge) => edge.type === "blocks")).toBe(false);
    expect(parsedEdges.edges.some((edge) => edge.type === "relates_to")).toBe(false);
    expect(parsedExport.schemaVersion).toBe("work-graph-explorer/v1");
    expect(parsedExport.command).toBe("export");
    expect(parsedExport.summary).toEqual({
      nodeCount: 8,
      edgeCount: 9,
      diagnosticCount: 1,
      nodeTypes: [
        { type: "scope", count: 4 },
        { type: "work-item", count: 2 },
        { type: "claim", count: 1 },
        { type: "record", count: 1 },
      ],
      edgeTypes: [
        { type: "records", count: 3 },
        { type: "belongs_to", count: 2 },
        { type: "locks", count: 2 },
        { type: "depends_on", count: 1 },
        { type: "implements", count: 1 },
      ],
    });
    expect(parsedExport.nodes).toHaveLength(8);
    expect(parsedExport.edges).toHaveLength(9);
    expect(parsedExport.diagnostics).toEqual([
      {
        classification: "unsupported",
        relativePath: "backlog/AGENTS.md",
        documentId: "backloga-2056",
        reasonCode: "unsupported-document-type",
      },
    ]);
    expect(parsedExport.nodes.some((node) => node.id === "backlog/AGENTS.md")).toBe(
      false,
    );
    expect(exportDot).toContain(
      '"record:work-graph-uac-review" -> "wi:70001" [label="records"]',
    );
    expect(dot.startsWith("digraph WorkGraph {\n")).toBe(true);

    const after = await snapshotFiles(rootDir);
    expect(after).toEqual(before);
  }, 15000);

  it("renders a standalone Cytoscape viewer from canonical export JSON without mutating the repo", async () => {
    const rootDir = await createTempRoot();
    await mkdir(rootDir, { recursive: true });

    await stageWorkGraphUacFixture(rootDir);
    const before = await snapshotFiles(rootDir);

    const exportPayloadPath = path.join(rootDir, "graph-export.json");
    const viewerPath = path.join(rootDir, "graph-viewer.html");
    const exportJson = runCli(rootDir, ["work", "graph", "export", "--format", "json"]);
    await writeFile(exportPayloadPath, exportJson, "utf8");

    runCli(rootDir, [
      "work",
      "graph",
      "visualize",
      "--input",
      exportPayloadPath,
      "--output",
      viewerPath,
    ]);

    const viewerHtml = await readFile(viewerPath, "utf8");
    expect(viewerHtml).toContain("<!DOCTYPE html>");
    expect(viewerHtml).toContain("Work Graph Viewer");
    expect(viewerHtml).toContain("https://unpkg.com/cytoscape");
    expect(viewerHtml).toContain('"schemaVersion":"work-graph-explorer/v1"');
    expect(viewerHtml).toContain('"id":"wi:70001"');
    expect(viewerHtml).toContain('"stableId":"wi:70001"');
    expect(viewerHtml).toContain('id="graph-search"');
    expect(viewerHtml).toContain('id="node-type-filters"');
    expect(viewerHtml).toContain('id="edge-type-filters"');
    expect(viewerHtml).toContain('id="traversal-incoming"');
    expect(viewerHtml).toContain('id="traversal-outgoing"');
    expect(viewerHtml).toContain('id="focus-neighborhood"');
    expect(viewerHtml).toContain('id="path-start"');
    expect(viewerHtml).toContain('id="path-end"');
    expect(viewerHtml).toContain('id="trace-path"');
    expect(viewerHtml).toContain('id="inspection-panel"');
    expect(viewerHtml).toContain("Read-only Artifact");
    expect(viewerHtml).toContain("Filters and search only change local visibility.");
    expect(viewerHtml).toContain("Trace a directed path between two nodes.");
    expect(viewerHtml).toContain("Diagnostics Context");
    expect(viewerHtml).toContain('"searchText":"wi:70001 work graph uac review main backlog/70001-work-graph-uac-main.md"');
    expect(viewerHtml).toContain('"relativePath":"backlog/AGENTS.md"');

    const after = await snapshotFiles(rootDir);
    expect(after.get("graph-export.json")).toBe(exportJson);
    expect(after.has("graph-viewer.html")).toBe(true);
    after.delete("graph-export.json");
    after.delete("graph-viewer.html");
    expect(after).toEqual(before);
  }, 15000);
});
