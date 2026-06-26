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

export type WorkGraphTraversalDirection = "incoming" | "outgoing" | "both";

export interface WorkGraphTraversalNeighborhood {
  readonly centerNodeId: string;
  readonly direction: WorkGraphTraversalDirection;
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
}

export interface WorkGraphPathTrace {
  readonly startNodeId: string;
  readonly endNodeId: string;
  readonly found: boolean;
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
}

type WorkGraphTraversalEdgeReference = {
  readonly nextNodeId: string;
  readonly edgeId: string;
};

type WorkGraphPathParentReference = {
  readonly nodeId: string;
  readonly edgeId: string;
};

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

function renderNodeSelectOptions(graph: WorkGraphCytoscapeDocument): string {
  return graph.elements
    .filter((element): element is WorkGraphCytoscapeNodeElement => element.group === "nodes")
    .map((element) => {
      const label = `${element.data.label} [${element.data.nodeType}] (${element.data.id})`;
      return `<option value="${escapeHtml(element.data.id)}">${escapeHtml(label)}</option>`;
    })
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

function listNodeIds(graph: WorkGraphCytoscapeDocument): Set<string> {
  return new Set(
    graph.elements
      .filter((element): element is WorkGraphCytoscapeNodeElement => element.group === "nodes")
      .map((element) => element.data.id),
  );
}

function listEdgeElements(
  graph: WorkGraphCytoscapeDocument,
): readonly WorkGraphCytoscapeEdgeElement[] {
  return graph.elements.filter(
    (element): element is WorkGraphCytoscapeEdgeElement => element.group === "edges",
  );
}

function createEmptyNeighborhood(
  centerNodeId: string,
  direction: WorkGraphTraversalDirection,
): WorkGraphTraversalNeighborhood {
  return { centerNodeId, direction, nodeIds: [], edgeIds: [] };
}

function createEmptyPathTrace(
  startNodeId: string,
  endNodeId: string,
): WorkGraphPathTrace {
  return {
    startNodeId,
    endNodeId,
    found: false,
    nodeIds: [],
    edgeIds: [],
  };
}

function buildDirectedAdjacency(
  edges: readonly WorkGraphCytoscapeEdgeElement[],
): Map<string, WorkGraphTraversalEdgeReference[]> {
  const adjacency = new Map<string, WorkGraphTraversalEdgeReference[]>();

  for (const edge of edges) {
    const nextEdge = { nextNodeId: edge.data.target, edgeId: edge.data.id };
    const currentEntries = adjacency.get(edge.data.source);
    if (currentEntries) {
      currentEntries.push(nextEdge);
      continue;
    }
    adjacency.set(edge.data.source, [nextEdge]);
  }

  return adjacency;
}

function collectNeighborhood(
  nodeIds: ReadonlySet<string>,
  edges: readonly WorkGraphCytoscapeEdgeElement[],
  centerNodeId: string,
  direction: WorkGraphTraversalDirection,
): WorkGraphTraversalNeighborhood {
  if (!nodeIds.has(centerNodeId)) {
    return createEmptyNeighborhood(centerNodeId, direction);
  }

  const seenNodeIds = new Set<string>([centerNodeId]);
  const neighborhoodNodeIds = [centerNodeId];
  const neighborhoodEdgeIds: string[] = [];
  const directions: readonly WorkGraphTraversalDirection[] =
    direction === "both" ? ["outgoing", "incoming"] : [direction];

  for (const traversalDirection of directions) {
    for (const edge of edges) {
      const matchesCenterNode = traversalDirection === "outgoing"
        ? edge.data.source === centerNodeId
        : edge.data.target === centerNodeId;

      if (!matchesCenterNode) {
        continue;
      }

      neighborhoodEdgeIds.push(edge.data.id);
      const neighborNodeId = traversalDirection === "outgoing"
        ? edge.data.target
        : edge.data.source;

      if (seenNodeIds.has(neighborNodeId)) {
        continue;
      }

      seenNodeIds.add(neighborNodeId);
      neighborhoodNodeIds.push(neighborNodeId);
    }
  }

  return {
    centerNodeId,
    direction,
    nodeIds: neighborhoodNodeIds,
    edgeIds: neighborhoodEdgeIds,
  };
}

function reconstructPathTrace(
  startNodeId: string,
  endNodeId: string,
  parents: ReadonlyMap<string, WorkGraphPathParentReference>,
): WorkGraphPathTrace {
  const pathNodeIds = [endNodeId];
  const pathEdgeIds: string[] = [];
  let cursor = endNodeId;

  while (cursor !== startNodeId) {
    const parent = parents.get(cursor);
    if (!parent) {
      return createEmptyPathTrace(startNodeId, endNodeId);
    }
    pathEdgeIds.unshift(parent.edgeId);
    pathNodeIds.unshift(parent.nodeId);
    cursor = parent.nodeId;
  }

  return {
    startNodeId,
    endNodeId,
    found: true,
    nodeIds: pathNodeIds,
    edgeIds: pathEdgeIds,
  };
}

function traceDirectedPath(
  nodeIds: ReadonlySet<string>,
  edges: readonly WorkGraphCytoscapeEdgeElement[],
  startNodeId: string,
  endNodeId: string,
): WorkGraphPathTrace {
  if (!nodeIds.has(startNodeId) || !nodeIds.has(endNodeId)) {
    return createEmptyPathTrace(startNodeId, endNodeId);
  }

  if (startNodeId === endNodeId) {
    return {
      startNodeId,
      endNodeId,
      found: true,
      nodeIds: [startNodeId],
      edgeIds: [],
    };
  }

  const adjacency = buildDirectedAdjacency(edges);
  const queue = [startNodeId];
  const visited = new Set<string>([startNodeId]);
  const parents = new Map<string, WorkGraphPathParentReference>();

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const currentNodeId = queue[queueIndex];

    for (const candidate of adjacency.get(currentNodeId) ?? []) {
      if (visited.has(candidate.nextNodeId)) {
        continue;
      }

      visited.add(candidate.nextNodeId);
      parents.set(candidate.nextNodeId, {
        nodeId: currentNodeId,
        edgeId: candidate.edgeId,
      });

      if (candidate.nextNodeId === endNodeId) {
        return reconstructPathTrace(startNodeId, endNodeId, parents);
      }

      queue.push(candidate.nextNodeId);
    }
  }

  return createEmptyPathTrace(startNodeId, endNodeId);
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

export function getWorkGraphNeighborhood(
  graph: WorkGraphCytoscapeDocument,
  centerNodeId: string,
  direction: WorkGraphTraversalDirection,
): WorkGraphTraversalNeighborhood {
  return collectNeighborhood(
    listNodeIds(graph),
    listEdgeElements(graph),
    centerNodeId,
    direction,
  );
}

export function findWorkGraphPathTrace(
  graph: WorkGraphCytoscapeDocument,
  startNodeId: string,
  endNodeId: string,
): WorkGraphPathTrace {
  return traceDirectedPath(
    listNodeIds(graph),
    listEdgeElements(graph),
    startNodeId,
    endNodeId,
  );
}

export function renderStandaloneWorkGraphViewer(
  graph: WorkGraphCytoscapeDocument,
): string {
  const payload = escapeInlineJson(JSON.stringify(graph));
  const title = "Work Graph Viewer";
  const summaryText = `${graph.summary.nodeCount} nodes, ${graph.summary.edgeCount} edges, ${graph.summary.diagnosticCount} diagnostics`;
  const nodeTypeOptions = renderFilterOptions("node", graph.summary.nodeTypes);
  const edgeTypeOptions = renderFilterOptions("edge", graph.summary.edgeTypes);
  const nodeSelectOptions = renderNodeSelectOptions(graph);
  const traversalRuntimeHelpers = [
    createEmptyNeighborhood,
    createEmptyPathTrace,
    buildDirectedAdjacency,
    collectNeighborhood,
    reconstructPathTrace,
    traceDirectedPath,
  ].map((helper) => helper.toString()).join("\n");

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
      .search-input,
      .control-select,
      .control-button {
        width: 100%;
        margin-top: 8px;
        padding: 10px 12px;
        border: 1px solid var(--line);
        border-radius: 10px;
        font: inherit;
        background: #fff;
        color: var(--ink);
      }
      .control-button {
        cursor: pointer;
        background: #f8fafc;
      }
      .filter-group {
        margin-top: 16px;
      }
      .filter-grid,
      .action-grid {
        display: grid;
        gap: 8px;
        margin-top: 10px;
      }
      .action-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
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
      .results[data-state="warning"] {
        color: #b45309;
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
          <div class="filter-group">
            <h2>Traversal</h2>
            <p class="control-help">Select a node, then expand incoming or outgoing one-hop neighbors.</p>
            <div class="action-grid">
              <button id="traversal-incoming" class="control-button" type="button">Expand Incoming</button>
              <button id="traversal-outgoing" class="control-button" type="button">Expand Outgoing</button>
              <button id="focus-neighborhood" class="control-button" type="button">Focus Neighborhood</button>
              <button id="clear-focus" class="control-button" type="button">Clear Focus</button>
            </div>
            <p id="traversal-results" class="results">Select a node to expand its one-hop neighbors.</p>
          </div>
          <div class="filter-group">
            <h2>Path Trace</h2>
            <label for="path-start">Path start</label>
            <select id="path-start" class="control-select">${nodeSelectOptions}</select>
            <label for="path-end" style="margin-top: 12px;">Path end</label>
            <select id="path-end" class="control-select">${nodeSelectOptions}</select>
            <div class="action-grid">
              <button id="trace-path" class="control-button" type="button">Trace Path</button>
              <button id="clear-path" class="control-button" type="button">Clear Path</button>
            </div>
            <p id="path-results" class="results">No directed path found between the selected nodes.</p>
          </div>
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
      const defaultTraversalMessage = "Select a node to expand its one-hop neighbors.";
      const defaultPathMessage = "Trace a directed path between two nodes.";
      const noPathMessage = "No directed path found between the selected nodes.";
      const nodeIds = new Set(
        graph.elements
          .filter((element) => element.group === "nodes")
          .map((element) => element.data.id)
      );
      const edgeElements = graph.elements.filter((element) => element.group === "edges");
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
        selectedElementId: null,
        traversal: null,
        focusNodeIds: null,
        focusEdgeIds: null,
        pathTrace: null
      };
      const searchInput = document.getElementById("graph-search");
      const nodeTypeFilters = document.getElementById("node-type-filters");
      const edgeTypeFilters = document.getElementById("edge-type-filters");
      const filterResults = document.getElementById("filter-results");
      const traversalResults = document.getElementById("traversal-results");
      const pathResults = document.getElementById("path-results");
      const inspectionPanel = document.getElementById("inspection-panel");
      const viewerStatus = document.getElementById("viewer-status");
      const traversalIncomingButton = document.getElementById("traversal-incoming");
      const traversalOutgoingButton = document.getElementById("traversal-outgoing");
      const focusNeighborhoodButton = document.getElementById("focus-neighborhood");
      const clearFocusButton = document.getElementById("clear-focus");
      const pathStartSelect = document.getElementById("path-start");
      const pathEndSelect = document.getElementById("path-end");
      const tracePathButton = document.getElementById("trace-path");
      const clearPathButton = document.getElementById("clear-path");
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
          },
          {
            selector: ".traversal-context",
            style: {
              "background-color": "#14b8a6",
              "line-color": "#14b8a6",
              "target-arrow-color": "#14b8a6",
              "border-color": "#0f766e"
            }
          },
          {
            selector: ".path-trace",
            style: {
              "background-color": "#2563eb",
              "line-color": "#2563eb",
              "target-arrow-color": "#2563eb",
              "border-color": "#1d4ed8",
              "width": 4
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
      ${traversalRuntimeHelpers}
      function getSelectedNodeEntry() {
        if (!state.selectedElementId) {
          return null;
        }
        const entry = inspectorEntries.get(state.selectedElementId);
        return entry && entry.kind === "node" ? entry : null;
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
      }
      function updateViewerStatus() {
        if (state.pathTrace && !state.pathTrace.found) {
          viewerStatus.textContent = noPathMessage;
          return;
        }
        if (state.pathTrace && state.pathTrace.found) {
          viewerStatus.textContent =
            "Directed path traced from " + state.pathTrace.startNodeId +
            " to " + state.pathTrace.endNodeId + ".";
          return;
        }
        if (state.focusNodeIds && state.focusEdgeIds) {
          viewerStatus.textContent =
            "Focused on " + state.focusNodeIds.size + " nodes and " +
            state.focusEdgeIds.size + " edges in the current traversal context.";
          return;
        }
        if (state.traversal) {
          viewerStatus.textContent =
            "Expanded " + state.traversal.direction + " one-hop neighbors from " +
            state.traversal.centerNodeId + ".";
          return;
        }
        viewerStatus.textContent = state.searchQuery
          ? "Filtered read-only view for search: " + state.searchQuery
          : defaultViewerStatus;
      }
      function clearSelection() {
        state.selectedElementId = null;
        cy.elements(":selected").unselect();
        renderInspection(null);
      }
      function applyHighlights() {
        cy.nodes().removeClass("traversal-context");
        cy.edges().removeClass("traversal-context");
        cy.nodes().removeClass("path-trace");
        cy.edges().removeClass("path-trace");
        if (state.traversal) {
          state.traversal.nodeIds.forEach((nodeId) => {
            cy.getElementById(nodeId).addClass("traversal-context");
          });
          state.traversal.edgeIds.forEach((edgeId) => {
            cy.getElementById(edgeId).addClass("traversal-context");
          });
        }
        if (state.pathTrace && state.pathTrace.found) {
          state.pathTrace.nodeIds.forEach((nodeId) => {
            cy.getElementById(nodeId).addClass("path-trace");
          });
          state.pathTrace.edgeIds.forEach((edgeId) => {
            cy.getElementById(edgeId).addClass("path-trace");
          });
        }
      }
      function applyFilters() {
        const visibleNodeIds = new Set();
        let visibleNodeCount = 0;
        let visibleEdgeCount = 0;
        cy.nodes().forEach((node) => {
          const entry = inspectorEntries.get(node.id());
          const visible = state.nodeTypes.has(entry.nodeType)
            && (!state.focusNodeIds || state.focusNodeIds.has(node.id()))
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
            && (!state.focusEdgeIds || state.focusEdgeIds.has(edge.id()))
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
        applyHighlights();
        updateViewerStatus();
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
      function expandTraversal(direction) {
        const selectedNode = getSelectedNodeEntry();
        if (!selectedNode) {
          state.traversal = null;
          state.focusNodeIds = null;
          state.focusEdgeIds = null;
          traversalResults.textContent = defaultTraversalMessage;
          applyFilters();
          return;
        }
        state.traversal = collectNeighborhood(
          nodeIds,
          edgeElements,
          selectedNode.id,
          direction,
        );
        state.focusNodeIds = null;
        state.focusEdgeIds = null;
        traversalResults.textContent =
          "Expanded " + direction + " one-hop neighbors from " + selectedNode.stableId +
          ": " + Math.max(state.traversal.nodeIds.length - 1, 0) + " nodes, " +
          state.traversal.edgeIds.length + " edges.";
        applyFilters();
      }
      function focusTraversalNeighborhood() {
        const selectedNode = getSelectedNodeEntry();
        if (!selectedNode) {
          traversalResults.textContent = "Select a node before focusing its one-hop neighborhood.";
          applyFilters();
          return;
        }
        if (!state.traversal || state.traversal.centerNodeId !== selectedNode.id) {
          state.traversal = collectNeighborhood(
            nodeIds,
            edgeElements,
            selectedNode.id,
            "both",
          );
        }
        state.focusNodeIds = new Set(state.traversal.nodeIds);
        state.focusEdgeIds = new Set(state.traversal.edgeIds);
        traversalResults.textContent =
          "Focused on the one-hop neighborhood around " + selectedNode.stableId + ".";
        applyFilters();
      }
      function clearFocus() {
        state.focusNodeIds = null;
        state.focusEdgeIds = null;
        traversalResults.textContent = defaultTraversalMessage;
        applyFilters();
      }
      function tracePath() {
        state.pathTrace = traceDirectedPath(
          nodeIds,
          edgeElements,
          pathStartSelect.value,
          pathEndSelect.value,
        );
        pathResults.dataset.state = state.pathTrace.found ? "info" : "warning";
        if (state.pathTrace.found) {
          pathResults.textContent =
            "Directed path traced from " + state.pathTrace.startNodeId +
            " to " + state.pathTrace.endNodeId + " across " +
            state.pathTrace.edgeIds.length + " edges.";
        } else {
          pathResults.textContent = noPathMessage;
        }
        applyFilters();
      }
      function clearPath() {
        state.pathTrace = null;
        pathResults.dataset.state = "info";
        pathResults.textContent = defaultPathMessage;
        applyFilters();
      }
      searchInput.addEventListener("input", (event) => {
        state.searchQuery = event.target.value.trim().toLowerCase();
        applyFilters();
      });
      attachFilterHandlers(nodeTypeFilters, state.nodeTypes);
      attachFilterHandlers(edgeTypeFilters, state.edgeTypes);
      traversalIncomingButton.addEventListener("click", () => expandTraversal("incoming"));
      traversalOutgoingButton.addEventListener("click", () => expandTraversal("outgoing"));
      focusNeighborhoodButton.addEventListener("click", focusTraversalNeighborhood);
      clearFocusButton.addEventListener("click", clearFocus);
      tracePathButton.addEventListener("click", tracePath);
      clearPathButton.addEventListener("click", clearPath);
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
      globalThis.__WORK_GRAPH_VIEWER__ = {
        expandIncoming: () => expandTraversal("incoming"),
        expandOutgoing: () => expandTraversal("outgoing"),
        focusNeighborhood: () => focusTraversalNeighborhood(),
        clearFocus: () => clearFocus(),
        tracePath: (startNodeId, endNodeId) => {
          pathStartSelect.value = startNodeId;
          pathEndSelect.value = endNodeId;
          tracePath();
          return state.pathTrace;
        },
        clearPath: () => clearPath(),
        getState: () => ({
          searchQuery: state.searchQuery,
          selectedElementId: state.selectedElementId,
          traversal: state.traversal,
          focusedNodeIds: state.focusNodeIds ? Array.from(state.focusNodeIds) : null,
          focusedEdgeIds: state.focusEdgeIds ? Array.from(state.focusEdgeIds) : null,
          pathTrace: state.pathTrace
        })
      };
      pathResults.dataset.state = "info";
      pathResults.textContent = defaultPathMessage;
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
