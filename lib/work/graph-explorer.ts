import { TaskCommandError } from "../task/errors.js";
import type {
  WorkGraphEdge,
  WorkGraphEdgeType,
  WorkGraphNode,
  WorkGraphNodeType,
  WorkGraphProjection,
  WorkGraphProjectionDiagnostic,
} from "./projection.js";

export type WorkGraphExplorerFormat = "json" | "dot";
export type WorkGraphExplorerCommand = "nodes" | "edges" | "inspect";

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

export interface WorkGraphNodesResult {
  readonly schemaVersion: "work-graph-explorer/v1";
  readonly command: "nodes";
  readonly filters: {
    readonly nodeTypes: readonly WorkGraphNodeType[];
  };
  readonly nodes: readonly WorkGraphNode[];
  readonly diagnostics: readonly WorkGraphProjectionDiagnostic[];
}

export interface WorkGraphEdgesResult {
  readonly schemaVersion: "work-graph-explorer/v1";
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
  readonly schemaVersion: "work-graph-explorer/v1";
  readonly command: "inspect";
  readonly node: WorkGraphNode;
  readonly neighborhood: WorkGraphNeighborhood;
  readonly diagnostics: readonly WorkGraphProjectionDiagnostic[];
}

export type WorkGraphExplorerResult =
  | WorkGraphNodesResult
  | WorkGraphEdgesResult
  | WorkGraphInspectResult;

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

function stableNodeIds(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])].sort((left, right) => left.localeCompare(right));
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
    default:
      throw new TaskCommandError(
        "WORK_GRAPH_FORMAT_UNSUPPORTED",
        "Work graph explorer format must be json or dot.",
        { format },
      );
  }
}

export function queryWorkGraphNodes(
  projection: WorkGraphProjection,
  query: WorkGraphNodesQuery = {},
): WorkGraphNodesResult {
  const nodeTypes = [...new Set(query.nodeTypes ?? [])].sort(
    (left, right) => left.localeCompare(right),
  );
  const nodes = stableNodes(
    nodeTypes.length === 0
      ? projection.nodes
      : projection.nodes.filter((node) => nodeTypes.includes(node.type)),
  );
  return {
    schemaVersion: "work-graph-explorer/v1",
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
  const edgeTypes = [...new Set(query.edgeTypes ?? [])].sort(
    (left, right) => left.localeCompare(right),
  );
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
    schemaVersion: "work-graph-explorer/v1",
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
  const neighborhoodNodes = dedupeNodes(
    [...outgoingEdges.map((edge) => projection.findNode(edge.to))]
      .concat(incomingEdges.map((edge) => projection.findNode(edge.from)))
      .filter((candidate): candidate is WorkGraphNode => Boolean(candidate)),
  );
  return {
    schemaVersion: "work-graph-explorer/v1",
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
