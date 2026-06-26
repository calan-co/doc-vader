import { TaskCommandError } from "../task/errors.js";
import type {
  WorkGraphEdge,
  WorkGraphEdgeType,
  WorkGraphNode,
  WorkGraphNodeType,
  WorkGraphProjection,
  WorkGraphProjectionDiagnostic,
} from "./projection.js";

export type WorkGraphExplorerFormat = "json" | "dot" | "table";
export type WorkGraphSummaryFormat = "table" | "json";
export type WorkGraphExportFormat = "json" | "dot";
export type WorkGraphExplorerCommand =
  | "nodes"
  | "edges"
  | "inspect"
  | "summary"
  | "export";
const WORK_GRAPH_EXPLORER_SCHEMA_VERSION = "work-graph-explorer/v1";

export interface WorkGraphNodesQuery {
  readonly nodeTypes?: readonly WorkGraphNodeType[];
}

export interface WorkGraphEdgesQuery {
  readonly edgeTypes?: readonly WorkGraphEdgeType[];
  readonly sourceNodeIds?: readonly string[];
  readonly targetNodeIds?: readonly string[];
  readonly nodeIds?: readonly string[];
}

export interface WorkGraphNeighborhood {
  readonly nodes: readonly WorkGraphNode[];
  readonly outgoingEdges: readonly WorkGraphEdge[];
  readonly incomingEdges: readonly WorkGraphEdge[];
}

export interface WorkGraphSummaryCount<T extends string> {
  readonly type: T;
  readonly count: number;
}

export interface WorkGraphSummary {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly diagnosticCount: number;
  readonly nodeTypes: readonly WorkGraphSummaryCount<WorkGraphNodeType>[];
  readonly edgeTypes: readonly WorkGraphSummaryCount<WorkGraphEdgeType>[];
}

export interface WorkGraphNodesResult {
  readonly schemaVersion: typeof WORK_GRAPH_EXPLORER_SCHEMA_VERSION;
  readonly command: "nodes";
  readonly filters: {
    readonly nodeTypes: readonly WorkGraphNodeType[];
  };
  readonly nodes: readonly WorkGraphNode[];
  readonly diagnostics: readonly WorkGraphProjectionDiagnostic[];
}

export interface WorkGraphEdgesResult {
  readonly schemaVersion: typeof WORK_GRAPH_EXPLORER_SCHEMA_VERSION;
  readonly command: "edges";
  readonly filters: {
    readonly edgeTypes: readonly WorkGraphEdgeType[];
    readonly sourceNodeIds: readonly string[];
    readonly targetNodeIds: readonly string[];
    readonly nodeIds: readonly string[];
  };
  readonly nodes: readonly WorkGraphNode[];
  readonly edges: readonly WorkGraphEdge[];
  readonly diagnostics: readonly WorkGraphProjectionDiagnostic[];
}

export interface WorkGraphInspectResult {
  readonly schemaVersion: typeof WORK_GRAPH_EXPLORER_SCHEMA_VERSION;
  readonly command: "inspect";
  readonly node: WorkGraphNode;
  readonly neighborhood: WorkGraphNeighborhood;
  readonly diagnostics: readonly WorkGraphProjectionDiagnostic[];
}

export interface WorkGraphSummaryResult {
  readonly schemaVersion: typeof WORK_GRAPH_EXPLORER_SCHEMA_VERSION;
  readonly command: "summary";
  readonly summary: WorkGraphSummary;
  readonly diagnostics: readonly WorkGraphProjectionDiagnostic[];
}

export interface WorkGraphExportResult {
  readonly schemaVersion: typeof WORK_GRAPH_EXPLORER_SCHEMA_VERSION;
  readonly command: "export";
  readonly summary: WorkGraphSummary;
  readonly nodes: readonly WorkGraphNode[];
  readonly edges: readonly WorkGraphEdge[];
  readonly diagnostics: readonly WorkGraphProjectionDiagnostic[];
}

export type WorkGraphExplorerResult =
  | WorkGraphNodesResult
  | WorkGraphEdgesResult
  | WorkGraphInspectResult
  | WorkGraphSummaryResult
  | WorkGraphExportResult;

export interface WorkGraphOutputExtension {
  readonly format: WorkGraphExplorerFormat;
  render(result: WorkGraphExplorerResult): string;
}

function stableNodes(nodes: readonly WorkGraphNode[]): WorkGraphNode[] {
  return [...nodes].sort((left, right) => left.id.localeCompare(right.id));
}

function stableEdges(edges: readonly WorkGraphEdge[]): WorkGraphEdge[] {
  return [...edges].sort(
    (left, right) =>
      left.type.localeCompare(right.type) ||
      left.from.localeCompare(right.from) ||
      left.to.localeCompare(right.to),
  );
}

function stableStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function stableCounts<T extends string>(
  values: Iterable<T>,
): WorkGraphSummaryCount<T>[] {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(
      ([leftType, leftCount], [rightType, rightCount]) =>
        rightCount - leftCount || leftType.localeCompare(rightType),
    )
    .map(([type, count]) => ({ type, count }));
}

function stableNodeIds(values: readonly string[] | undefined): string[] {
  return stableStrings(values ?? []);
}

function escapeDotValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

function dedupeNodes(nodes: readonly WorkGraphNode[]): WorkGraphNode[] {
  const unique = new Map<string, WorkGraphNode>();
  for (const node of nodes) {
    unique.set(node.id, node);
  }
  return stableNodes([...unique.values()]);
}

function collectEdgeEndpointNodes(
  projection: WorkGraphProjection,
  edges: readonly WorkGraphEdge[],
): WorkGraphNode[] {
  const nodes: WorkGraphNode[] = [];
  for (const edge of edges) {
    const sourceNode = projection.findNode(edge.from);
    if (sourceNode) {
      nodes.push(sourceNode);
    }
    const targetNode = projection.findNode(edge.to);
    if (targetNode) {
      nodes.push(targetNode);
    }
  }
  return dedupeNodes(nodes);
}

class JsonWorkGraphOutputExtension implements WorkGraphOutputExtension {
  readonly format = "json" as const;

  render(result: WorkGraphExplorerResult): string {
    return JSON.stringify(result, null, 2);
  }
}

class DotWorkGraphOutputExtension implements WorkGraphOutputExtension {
  readonly format = "dot" as const;

  render(result: WorkGraphExplorerResult): string {
    const [nodes, edges] = dotSelection(result);
    const lines = ["digraph WorkGraph {"];
    for (const node of nodes) {
      lines.push(
        `  "${escapeDotValue(node.id)}" [label="${escapeDotValue(node.label)}"];`,
      );
    }
    for (const edge of edges) {
      lines.push(
        `  "${escapeDotValue(edge.from)}" -> "${escapeDotValue(edge.to)}" [label="${escapeDotValue(edge.type)}"];`,
      );
    }
    lines.push("}");
    return `${lines.join("\n")}\n`;
  }
}

class TableWorkGraphOutputExtension implements WorkGraphOutputExtension {
  readonly format = "table" as const;

  render(result: WorkGraphExplorerResult): string {
    if (result.command !== "summary") {
      throw new TaskCommandError(
        "WORK_GRAPH_FORMAT_UNSUPPORTED",
        "Work graph table output is only supported for summary.",
        { command: result.command, format: this.format },
      );
    }

    const formatCounts = <T extends string>(
      counts: readonly WorkGraphSummaryCount<T>[],
    ): string => {
      if (counts.length === 0) {
        return "0";
      }
      return counts.map(({ type, count }) => `${count} ${type}`).join(", ");
    };

    const lines = [
      "Work Graph Summary",
      `Nodes\t${formatCounts(result.summary.nodeTypes)}`,
      `Edges\t${formatCounts(result.summary.edgeTypes)}`,
      `Diagnostics\t${result.summary.diagnosticCount}`,
      `Totals\t${result.summary.nodeCount} nodes, ${result.summary.edgeCount} edges`,
    ];
    return `${lines.join("\n")}\n`;
  }
}

function collectInspectNodes(
  projection: WorkGraphProjection,
  node: WorkGraphNode,
  outgoingEdges: readonly WorkGraphEdge[],
  incomingEdges: readonly WorkGraphEdge[],
): WorkGraphNode[] {
  const neighborhoodNodes: WorkGraphNode[] = [node];

  for (const edge of outgoingEdges) {
    const targetNode = projection.findNode(edge.to);
    if (targetNode) {
      neighborhoodNodes.push(targetNode);
    }
  }

  for (const edge of incomingEdges) {
    const sourceNode = projection.findNode(edge.from);
    if (sourceNode) {
      neighborhoodNodes.push(sourceNode);
    }
  }

  return dedupeNodes(neighborhoodNodes);
}

function dotSelection(
  result: WorkGraphExplorerResult,
): readonly [readonly WorkGraphNode[], readonly WorkGraphEdge[]] {
  switch (result.command) {
    case "nodes":
      return [stableNodes(result.nodes), []];
    case "edges":
      return [stableNodes(result.nodes), stableEdges(result.edges)];
    case "inspect":
      return [
        dedupeNodes([result.node, ...result.neighborhood.nodes]),
        stableEdges([
          ...result.neighborhood.outgoingEdges,
          ...result.neighborhood.incomingEdges,
        ]),
      ];
    case "export":
      return [stableNodes(result.nodes), stableEdges(result.edges)];
    case "summary":
      throw new TaskCommandError(
        "WORK_GRAPH_FORMAT_UNSUPPORTED",
        "Work graph summary cannot be rendered as dot.",
        { command: result.command, format: "dot" },
      );
  }
}

export function createWorkGraphOutputExtension(
  format: WorkGraphExplorerFormat,
): WorkGraphOutputExtension {
  switch (format) {
    case "json":
      return new JsonWorkGraphOutputExtension();
    case "dot":
      return new DotWorkGraphOutputExtension();
    case "table":
      return new TableWorkGraphOutputExtension();
    default:
      throw new TaskCommandError(
        "WORK_GRAPH_FORMAT_UNSUPPORTED",
        "Work graph explorer format must be json, dot, or table.",
        { format },
      );
  }
}

function summarizeWorkGraph(
  projection: WorkGraphProjection,
): WorkGraphSummary {
  return {
    nodeCount: projection.nodes.length,
    edgeCount: projection.edges.length,
    diagnosticCount: projection.diagnostics.length,
    nodeTypes: stableCounts(projection.nodes.map((node) => node.type)),
    edgeTypes: stableCounts(projection.edges.map((edge) => edge.type)),
  };
}

export function queryWorkGraphNodes(
  projection: WorkGraphProjection,
  query: WorkGraphNodesQuery = {},
): WorkGraphNodesResult {
  const nodeTypes = stableStrings(query.nodeTypes ?? []) as WorkGraphNodeType[];
  const nodes = stableNodes(
    nodeTypes.length === 0
      ? projection.nodes
      : projection.nodes.filter((node) => nodeTypes.includes(node.type)),
  );
  return {
    schemaVersion: WORK_GRAPH_EXPLORER_SCHEMA_VERSION,
    command: "nodes",
    filters: {
      nodeTypes,
    },
    nodes,
    diagnostics: projection.diagnostics,
  };
}

export function queryWorkGraphEdges(
  projection: WorkGraphProjection,
  query: WorkGraphEdgesQuery = {},
): WorkGraphEdgesResult {
  const edgeTypes = stableStrings(query.edgeTypes ?? []) as WorkGraphEdgeType[];
  const sourceNodeIds = stableNodeIds(query.sourceNodeIds);
  const targetNodeIds = stableNodeIds(query.targetNodeIds);
  const nodeIds = stableNodeIds(query.nodeIds);
  const edges = stableEdges(
    projection.edges.filter((edge) => {
      if (edgeTypes.length > 0 && !edgeTypes.includes(edge.type)) {
        return false;
      }
      if (sourceNodeIds.length > 0 && !sourceNodeIds.includes(edge.from)) {
        return false;
      }
      if (targetNodeIds.length > 0 && !targetNodeIds.includes(edge.to)) {
        return false;
      }
      if (
        nodeIds.length > 0 &&
        !nodeIds.includes(edge.from) &&
        !nodeIds.includes(edge.to)
      ) {
        return false;
      }
      return true;
    }),
  );
  const nodes = collectEdgeEndpointNodes(projection, edges);
  return {
    schemaVersion: WORK_GRAPH_EXPLORER_SCHEMA_VERSION,
    command: "edges",
    filters: {
      edgeTypes,
      sourceNodeIds,
      targetNodeIds,
      nodeIds,
    },
    nodes,
    edges,
    diagnostics: projection.diagnostics,
  };
}

export function inspectWorkGraphNode(
  projection: WorkGraphProjection,
  nodeId: string,
): WorkGraphInspectResult {
  const node = projection.findNode(nodeId);
  if (!node) {
    throw new TaskCommandError(
      "WORK_GRAPH_NODE_NOT_FOUND",
      `Work graph node '${nodeId}' was not found.`,
      { nodeId },
    );
  }
  const outgoingEdges = stableEdges(projection.getOutgoingEdges(nodeId));
  const incomingEdges = stableEdges(projection.getIncomingEdges(nodeId));
  const neighborhoodNodes = collectInspectNodes(
    projection,
    node,
    outgoingEdges,
    incomingEdges,
  );
  return {
    schemaVersion: WORK_GRAPH_EXPLORER_SCHEMA_VERSION,
    command: "inspect",
    node,
    neighborhood: {
      nodes: neighborhoodNodes,
      outgoingEdges,
      incomingEdges,
    },
    diagnostics: projection.diagnostics,
  };
}

export function summarizeWorkGraphProjection(
  projection: WorkGraphProjection,
): WorkGraphSummaryResult {
  return {
    schemaVersion: WORK_GRAPH_EXPLORER_SCHEMA_VERSION,
    command: "summary",
    summary: summarizeWorkGraph(projection),
    diagnostics: projection.diagnostics,
  };
}

export function exportWorkGraph(
  projection: WorkGraphProjection,
): WorkGraphExportResult {
  return {
    schemaVersion: WORK_GRAPH_EXPLORER_SCHEMA_VERSION,
    command: "export",
    summary: summarizeWorkGraph(projection),
    nodes: stableNodes(projection.nodes),
    edges: stableEdges(projection.edges),
    diagnostics: projection.diagnostics,
  };
}
