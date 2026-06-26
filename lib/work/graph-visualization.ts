import { promises as fs } from "node:fs";
import path from "node:path";
import { TaskCommandError } from "../task/errors.js";
import type { WorkGraphExportResult, WorkGraphSummary } from "./graph-explorer.js";
import type {
  WorkGraphEdge,
  WorkGraphNode,
  WorkGraphProjectionDiagnostic,
} from "./projection.js";

export interface WorkGraphCytoscapeNodeElement {
  readonly group: "nodes";
  readonly data: {
    readonly id: string;
    readonly label: string;
    readonly stableId: string;
    readonly nodeType: WorkGraphNode["type"];
    readonly provenance: WorkGraphNode["source"];
    readonly properties: WorkGraphNode["properties"];
  };
}

export interface WorkGraphCytoscapeEdgeElement {
  readonly group: "edges";
  readonly data: {
    readonly id: string;
    readonly source: string;
    readonly target: string;
    readonly label: string;
    readonly stableId: string;
    readonly edgeType: WorkGraphEdge["type"];
    readonly direction: WorkGraphEdge["direction"];
    readonly provenance: WorkGraphEdge["source"];
    readonly properties: WorkGraphEdge["properties"];
  };
}

export interface WorkGraphCytoscapeDocument {
  readonly schemaVersion: WorkGraphExportResult["schemaVersion"];
  readonly sourceCommand: WorkGraphExportResult["command"];
  readonly summary: WorkGraphSummary;
  readonly elements: readonly (
    | WorkGraphCytoscapeNodeElement
    | WorkGraphCytoscapeEdgeElement
  )[];
  readonly diagnostics: readonly WorkGraphProjectionDiagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function escapeInlineJson(value: string): string {
  return value.replace(/</g, "\\u003c");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

export function assertWorkGraphExportResult(
  value: unknown,
): WorkGraphExportResult {
  if (!isRecord(value)) {
    throw new TaskCommandError(
      "WORK_GRAPH_EXPORT_INVALID",
      "Work graph export payload must be a JSON object.",
    );
  }
  if (value.schemaVersion !== "work-graph-explorer/v1") {
    throw new TaskCommandError(
      "WORK_GRAPH_EXPORT_INVALID",
      "Work graph export payload must use schemaVersion work-graph-explorer/v1.",
      { schemaVersion: value.schemaVersion },
    );
  }
  if (value.command !== "export") {
    throw new TaskCommandError(
      "WORK_GRAPH_EXPORT_INVALID",
      "Work graph visualization requires a canonical export payload.",
      { command: value.command },
    );
  }
  if (
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges) ||
    !Array.isArray(value.diagnostics) ||
    !isRecord(value.summary)
  ) {
    throw new TaskCommandError(
      "WORK_GRAPH_EXPORT_INVALID",
      "Work graph export payload is missing summary, nodes, edges, or diagnostics.",
    );
  }
  return value as unknown as WorkGraphExportResult;
}

export async function readWorkGraphExportFile(
  filePath: string,
): Promise<WorkGraphExportResult> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    throw new TaskCommandError(
      "WORK_GRAPH_EXPORT_READ_FAILED",
      `Unable to read work graph export file '${filePath}'.`,
      { filePath, cause: error instanceof Error ? error.message : String(error) },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new TaskCommandError(
      "WORK_GRAPH_EXPORT_INVALID_JSON",
      `Work graph export file '${filePath}' is not valid JSON.`,
      { filePath, cause: error instanceof Error ? error.message : String(error) },
    );
  }
  return assertWorkGraphExportResult(parsed);
}

export function adaptWorkGraphExportToCytoscape(
  result: WorkGraphExportResult,
): WorkGraphCytoscapeDocument {
  const nodeElements: WorkGraphCytoscapeNodeElement[] = result.nodes.map((node) => ({
    group: "nodes",
    data: {
      id: node.id,
      label: node.label,
      stableId: node.stableId,
      nodeType: node.type,
      provenance: node.source,
      properties: node.properties,
    },
  }));

  const edgeElements: WorkGraphCytoscapeEdgeElement[] = result.edges.map((edge) => ({
    group: "edges",
    data: {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      label: edge.type,
      stableId: edge.id,
      edgeType: edge.type,
      direction: edge.direction,
      provenance: edge.source,
      properties: edge.properties,
    },
  }));

  return {
    schemaVersion: result.schemaVersion,
    sourceCommand: result.command,
    summary: result.summary,
    elements: [...nodeElements, ...edgeElements],
    diagnostics: result.diagnostics,
  };
}

export function renderStandaloneWorkGraphViewer(
  graph: WorkGraphCytoscapeDocument,
): string {
  const payload = escapeInlineJson(JSON.stringify(graph));
  const title = "Work Graph Viewer";
  const summaryText = `${graph.summary.nodeCount} nodes, ${graph.summary.edgeCount} edges, ${graph.summary.diagnosticCount} diagnostics`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f1e8;
        --panel: rgba(255, 252, 247, 0.96);
        --ink: #1c1917;
        --muted: #57534e;
        --line: #d6d3d1;
        --accent: #0f766e;
        --accent-soft: #ccfbf1;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, "Iowan Old Style", serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(15, 118, 110, 0.16), transparent 30%),
          linear-gradient(180deg, #faf7f1 0%, var(--bg) 100%);
      }
      .shell {
        min-height: 100vh;
        display: grid;
        grid-template-columns: minmax(280px, 360px) 1fr;
      }
      .sidebar {
        padding: 24px;
        border-right: 1px solid var(--line);
        background: var(--panel);
        backdrop-filter: blur(8px);
      }
      .eyebrow {
        margin: 0 0 12px;
        font: 600 12px/1.2 ui-monospace, SFMono-Regular, monospace;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--accent);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 2rem;
        line-height: 1;
      }
      .summary, .diagnostics {
        margin-top: 20px;
        padding: 16px;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.7);
      }
      .summary p, .diagnostics p {
        margin: 0 0 12px;
        color: var(--muted);
      }
      .summary ul, .diagnostics ul {
        margin: 0;
        padding-left: 18px;
      }
      .viewer {
        min-height: 100vh;
        position: relative;
      }
      #graph {
        position: absolute;
        inset: 0;
      }
      .badge {
        display: inline-block;
        padding: 4px 8px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font: 600 12px/1.2 ui-monospace, SFMono-Regular, monospace;
      }
      @media (max-width: 900px) {
        .shell { grid-template-columns: 1fr; }
        .sidebar { border-right: 0; border-bottom: 1px solid var(--line); }
        .viewer { min-height: 70vh; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <aside class="sidebar">
        <p class="eyebrow">Standalone Artifact</p>
        <h1>${title}</h1>
        <p class="badge">${escapeHtml(graph.schemaVersion)}</p>
        <section class="summary">
          <p>${escapeHtml(summaryText)}</p>
          <ul>
            ${graph.summary.nodeTypes
              .map(
                (entry) =>
                  `<li>node:${escapeHtml(entry.type)} = ${entry.count}</li>`,
              )
              .join("")}
            ${graph.summary.edgeTypes
              .map(
                (entry) =>
                  `<li>edge:${escapeHtml(entry.type)} = ${entry.count}</li>`,
              )
              .join("")}
          </ul>
        </section>
        <section class="diagnostics">
          <p>Diagnostics are preserved outside Cytoscape elements.</p>
          <ul>
            ${graph.diagnostics
              .map(
                (entry) =>
                  `<li>${escapeHtml(entry.relativePath)} (${escapeHtml(entry.reasonCode)})</li>`,
              )
              .join("") || "<li>none</li>"}
          </ul>
        </section>
      </aside>
      <main class="viewer">
        <div id="graph" aria-label="Work graph visualization"></div>
      </main>
    </div>
    <script id="work-graph-data" type="application/json">${payload}</script>
    <script src="https://unpkg.com/cytoscape@3.33.1/dist/cytoscape.min.js"></script>
    <script>
      const graph = JSON.parse(document.getElementById("work-graph-data").textContent);
      const elements = graph.elements;
      cytoscape({
        container: document.getElementById("graph"),
        elements,
        layout: { name: "cose", animate: false, padding: 24 },
        style: [
          {
            selector: "node",
            style: {
              "background-color": "#0f766e",
              "label": "data(label)",
              "color": "#1c1917",
              "font-size": 11,
              "text-wrap": "wrap",
              "text-max-width": 120,
              "border-width": 1,
              "border-color": "#134e4a",
              "text-valign": "bottom",
              "text-margin-y": -8
            }
          },
          {
            selector: "edge",
            style: {
              "curve-style": "bezier",
              "line-color": "#78716c",
              "target-arrow-color": "#78716c",
              "target-arrow-shape": "triangle",
              "label": "data(label)",
              "font-size": 9,
              "color": "#44403c",
              "text-background-opacity": 1,
              "text-background-color": "#fffbeb",
              "text-background-padding": 2
            }
          }
        ]
      });
    </script>
  </body>
</html>
`;
}

export async function writeStandaloneWorkGraphViewer(options: {
  readonly inputPath: string;
  readonly outputPath: string;
}): Promise<void> {
  const canonicalGraph = await readWorkGraphExportFile(options.inputPath);
  const cytoscapeGraph = adaptWorkGraphExportToCytoscape(canonicalGraph);
  const html = renderStandaloneWorkGraphViewer(cytoscapeGraph);
  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
  await fs.writeFile(options.outputPath, html, "utf8");
}
