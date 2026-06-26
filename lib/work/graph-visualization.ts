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
    readonly filePath?: string;
    readonly searchText: string;
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
    readonly filePath?: string;
    readonly searchText: string;
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

function searchText(parts: readonly (string | undefined)[]): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .trim()
    .toLowerCase();
}

function provenanceFilePath(
  provenance: WorkGraphNode["source"] | WorkGraphEdge["source"],
): string | undefined {
  return typeof provenance.filePath === "string" ? provenance.filePath : undefined;
}

function renderFilterOptions(
  prefix: "node" | "edge",
  entries: readonly { readonly type: string; readonly count: number }[],
): string {
  return entries
    .map(
      (entry) =>
        `<label class="filter-option"><input type="checkbox" value="${escapeHtml(entry.type)}" checked /> <span>${prefix}:${escapeHtml(entry.type)}</span> <span class="filter-count">${entry.count}</span></label>`,
    )
    .join("");
}

function adaptNodeElement(node: WorkGraphNode): WorkGraphCytoscapeNodeElement {
  const filePath = provenanceFilePath(node.source);
  return {
    group: "nodes",
    data: {
      id: node.id,
      label: node.label,
      stableId: node.stableId,
      nodeType: node.type,
      provenance: node.source,
      properties: node.properties,
      filePath,
      searchText: searchText([node.stableId, node.label, filePath]),
    },
  };
}

function adaptEdgeElement(edge: WorkGraphEdge): WorkGraphCytoscapeEdgeElement {
  const filePath = provenanceFilePath(edge.source);
  return {
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
      filePath,
      searchText: searchText([edge.id, edge.type, filePath]),
    },
  };
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
  return {
    schemaVersion: result.schemaVersion,
    sourceCommand: result.command,
    summary: result.summary,
    elements: [
      ...result.nodes.map(adaptNodeElement),
      ...result.edges.map(adaptEdgeElement),
    ],
    diagnostics: result.diagnostics,
  };
}

export function renderStandaloneWorkGraphViewer(
  graph: WorkGraphCytoscapeDocument,
): string {
  const payload = escapeInlineJson(JSON.stringify(graph));
  const title = "Work Graph Viewer";
  const summaryText = `${graph.summary.nodeCount} nodes, ${graph.summary.edgeCount} edges, ${graph.summary.diagnosticCount} diagnostics`;
  const nodeTypeOptions = renderFilterOptions("node", graph.summary.nodeTypes);
  const edgeTypeOptions = renderFilterOptions("edge", graph.summary.edgeTypes);

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
      .controls, .inspection {
        margin-top: 20px;
        padding: 16px;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.82);
      }
      .summary p, .diagnostics p {
        margin: 0 0 12px;
        color: var(--muted);
      }
      .summary ul, .diagnostics ul {
        margin: 0;
        padding-left: 18px;
      }
      .controls label,
      .inspection h2,
      .inspection h3 {
        display: block;
      }
      .controls h2,
      .inspection h2,
      .inspection h3 {
        margin: 0 0 12px;
        font-size: 1rem;
      }
      .control-help,
      .inspection-empty,
      .results {
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 0.95rem;
      }
      .search-input {
        width: 100%;
        margin-top: 8px;
        padding: 10px 12px;
        border: 1px solid var(--line);
        border-radius: 10px;
        font: inherit;
        background: #fff;
        color: var(--ink);
      }
      .filter-group {
        margin-top: 16px;
      }
      .filter-grid {
        display: grid;
        gap: 8px;
        margin-top: 10px;
      }
      .filter-option {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 8px;
        align-items: center;
        padding: 8px 10px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.9);
      }
      .filter-count {
        color: var(--muted);
        font: 600 12px/1.2 ui-monospace, SFMono-Regular, monospace;
      }
      .inspection-meta {
        margin: 0;
        display: grid;
        grid-template-columns: minmax(88px, 112px) 1fr;
        gap: 8px 12px;
        font-size: 0.95rem;
      }
      .inspection-meta dt {
        margin: 0;
        color: var(--muted);
        font-weight: 600;
      }
      .inspection-meta dd {
        margin: 0;
        word-break: break-word;
      }
      .json-block {
        margin: 12px 0 0;
        padding: 12px;
        border-radius: 12px;
        background: #1c1917;
        color: #f5f5f4;
        overflow-x: auto;
        font: 12px/1.5 ui-monospace, SFMono-Regular, monospace;
      }
      .inspection-list {
        margin: 10px 0 0;
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
      .viewer-header {
        position: absolute;
        top: 16px;
        left: 16px;
        z-index: 1;
        display: flex;
        gap: 10px;
        align-items: center;
        padding: 12px 14px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: rgba(255, 252, 247, 0.92);
        backdrop-filter: blur(8px);
      }
      .viewer-status {
        color: var(--muted);
        font-size: 0.95rem;
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
        <section class="controls">
          <h2>Review Controls</h2>
          <label for="graph-search">Search graph</label>
          <input
            id="graph-search"
            class="search-input"
            type="search"
            placeholder="Search by stable id, label, or source file"
          />
          <p class="control-help">Search by stable id, label, or source file.</p>
          <div class="filter-group">
            <h2>Node Types</h2>
            <div id="node-type-filters" class="filter-grid">${nodeTypeOptions}</div>
          </div>
          <div class="filter-group">
            <h2>Edge Types</h2>
            <div id="edge-type-filters" class="filter-grid">${edgeTypeOptions}</div>
          </div>
          <p id="filter-results" class="results">${escapeHtml(summaryText)} visible</p>
        </section>
        <section class="inspection">
          <h2>Inspection</h2>
          <div id="inspection-panel">
            <p class="inspection-empty">Select a node or edge to inspect its stable metadata.</p>
          </div>
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
        <div class="viewer-header">
          <span class="badge">Read-only Artifact</span>
          <span id="viewer-status" class="viewer-status">Filters and search only change local visibility.</span>
        </div>
        <div id="graph" aria-label="Work graph visualization"></div>
      </main>
    </div>
    <script id="work-graph-data" type="application/json">${payload}</script>
    <script src="https://unpkg.com/cytoscape@3.33.1/dist/cytoscape.min.js"></script>
    <script>
      const graph = JSON.parse(document.getElementById("work-graph-data").textContent);
      const emptyInspectionMarkup = "<p class=\\"inspection-empty\\">Select a node or edge to inspect its stable metadata.</p>";
      const defaultViewerStatus = "Filters and search only change local visibility.";
      const diagnosticsByPath = new Map();
      graph.diagnostics.forEach((entry) => {
        const currentEntries = diagnosticsByPath.get(entry.relativePath);
        if (currentEntries) {
          currentEntries.push(entry);
          return;
        }
        diagnosticsByPath.set(entry.relativePath, [entry]);
      });
      const inspectorEntries = new Map(graph.elements.map((element) => {
        const fileDiagnostics = element.data.filePath
          ? diagnosticsByPath.get(element.data.filePath) || []
          : [];
        return [element.data.id, {
          kind: element.group === "nodes" ? "node" : "edge",
          ...element.data,
          relatedDiagnostics: fileDiagnostics
        }];
      }));
      const state = {
        searchQuery: "",
        nodeTypes: new Set(graph.summary.nodeTypes.map((entry) => entry.type)),
        edgeTypes: new Set(graph.summary.edgeTypes.map((entry) => entry.type)),
        selectedElementId: null
      };
      const searchInput = document.getElementById("graph-search");
      const nodeTypeFilters = document.getElementById("node-type-filters");
      const edgeTypeFilters = document.getElementById("edge-type-filters");
      const filterResults = document.getElementById("filter-results");
      const inspectionPanel = document.getElementById("inspection-panel");
      const viewerStatus = document.getElementById("viewer-status");
      const cy = cytoscape({
        container: document.getElementById("graph"),
        elements: graph.elements,
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
              "text-margin-y": -8,
              "overlay-opacity": 0
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
              "text-background-padding": 2,
              "overlay-opacity": 0
            }
          },
          {
            selector: ":selected",
            style: {
              "border-width": 3,
              "border-color": "#b45309",
              "line-color": "#b45309",
              "target-arrow-color": "#b45309",
              "background-color": "#f59e0b"
            }
          }
        ]
      });
      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }
      function prettyJson(value) {
        return escapeHtml(JSON.stringify(value, null, 2));
      }
      function renderDiagnostics(items) {
        if (!items.length) {
          return "<p class=\\"control-help\\">No related diagnostics for this selection.</p>";
        }
        return [
          "<h3>Diagnostics Context</h3>",
          "<ul class=\\"inspection-list\\">",
          items.map((item) =>
            "<li>" +
              escapeHtml(item.relativePath) +
              " [" + escapeHtml(item.classification) + "] " +
              escapeHtml(item.reasonCode) +
            "</li>"
          ).join(""),
          "</ul>"
        ].join("");
      }
      function renderInspection(entry) {
        if (!entry) {
          inspectionPanel.innerHTML = emptyInspectionMarkup;
          return;
        }
        const details = [];
        if (entry.kind === "node") {
          details.push(
            ["kind", "node"],
            ["id", entry.id],
            ["stable id", entry.stableId],
            ["label", entry.label],
            ["node type", entry.nodeType],
            ["source kind", entry.provenance.kind],
            ["source file", entry.filePath || "none"]
          );
        } else {
          details.push(
            ["kind", "edge"],
            ["id", entry.id],
            ["stable id", entry.stableId],
            ["edge type", entry.edgeType],
            ["direction", entry.direction],
            ["source", entry.source],
            ["target", entry.target],
            ["source kind", entry.provenance.kind],
            ["source file", entry.filePath || "none"]
          );
        }
        inspectionPanel.innerHTML = [
          "<h3>" + escapeHtml(entry.label || entry.edgeType || entry.id) + "</h3>",
          "<dl class=\\"inspection-meta\\">",
          details.map(([label, value]) =>
            "<dt>" + escapeHtml(label) + "</dt><dd>" + escapeHtml(value) + "</dd>"
          ).join(""),
          "</dl>",
          "<h3>Provenance</h3>",
          "<pre class=\\"json-block\\">" + prettyJson(entry.provenance) + "</pre>",
          "<h3>Graph Properties</h3>",
          "<pre class=\\"json-block\\">" + prettyJson(entry.properties) + "</pre>",
          renderDiagnostics(entry.relatedDiagnostics)
        ].join("");
      }
      function updateVisibleCounts(nodeCount, edgeCount) {
        filterResults.textContent = nodeCount + " nodes, " + edgeCount + " edges visible";
        viewerStatus.textContent = state.searchQuery
          ? "Filtered read-only view for search: " + state.searchQuery
          : defaultViewerStatus;
      }
      function clearSelection() {
        state.selectedElementId = null;
        cy.elements(":selected").unselect();
        renderInspection(null);
      }
      function applyFilters() {
        const visibleNodeIds = new Set();
        let visibleNodeCount = 0;
        let visibleEdgeCount = 0;
        cy.nodes().forEach((node) => {
          const entry = inspectorEntries.get(node.id());
          const visible = state.nodeTypes.has(entry.nodeType)
            && (!state.searchQuery || entry.searchText.includes(state.searchQuery));
          node.style("display", visible ? "element" : "none");
          if (visible) {
            visibleNodeIds.add(node.id());
            visibleNodeCount += 1;
          }
        });
        cy.edges().forEach((edge) => {
          const entry = inspectorEntries.get(edge.id());
          const visible = state.edgeTypes.has(entry.edgeType)
            && visibleNodeIds.has(entry.source)
            && visibleNodeIds.has(entry.target)
            && (!state.searchQuery || entry.searchText.includes(state.searchQuery));
          edge.style("display", visible ? "element" : "none");
          if (visible) {
            visibleEdgeCount += 1;
          }
        });
        updateVisibleCounts(visibleNodeCount, visibleEdgeCount);
        if (state.selectedElementId) {
          const selected = cy.getElementById(state.selectedElementId);
          if (selected.empty() || selected.style("display") === "none") {
            clearSelection();
          }
        }
      }
      function attachFilterHandlers(container, targetSet) {
        container.querySelectorAll("input[type=\\"checkbox\\"]").forEach((input) => {
          input.addEventListener("change", () => {
            if (input.checked) {
              targetSet.add(input.value);
            } else {
              targetSet.delete(input.value);
            }
            applyFilters();
          });
        });
      }
      searchInput.addEventListener("input", (event) => {
        state.searchQuery = event.target.value.trim().toLowerCase();
        applyFilters();
      });
      attachFilterHandlers(nodeTypeFilters, state.nodeTypes);
      attachFilterHandlers(edgeTypeFilters, state.edgeTypes);
      cy.on("select", "node, edge", (event) => {
        const entry = inspectorEntries.get(event.target.id());
        state.selectedElementId = event.target.id();
        renderInspection(entry);
      });
      cy.on("tap", (event) => {
        if (event.target === cy) {
          clearSelection();
        }
      });
      applyFilters();
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
