import matter from "gray-matter";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  openRuntimeSqliteStore,
  type RuntimeClaimRecord,
} from "../runtime/index.js";
import { canonicalizeScopeRef, canonicalizeWorkItemScopeRef } from "./scope-ref.js";

type JsonObject = Record<string, unknown>;

export type WorkGraphNodeType = "work-item" | "claim" | "record" | "scope";

export type WorkGraphEdgeType = "depends_on" | "belongs_to" | "implements";

export interface WorkGraphNode {
  id: string;
  type: WorkGraphNodeType;
  stableId: string;
  label: string;
  source: {
    kind: "work-item" | "claim" | "record" | "scope";
    filePath?: string;
    claimToken?: string;
  };
  properties: JsonObject;
}

export interface WorkGraphEdge {
  id: string;
  type: WorkGraphEdgeType;
  from: string;
  to: string;
  direction: "authored";
  source: {
    kind: "frontmatter" | "relationships" | "runtime";
    filePath?: string;
    claimToken?: string;
  };
  properties: JsonObject;
}

export interface WorkGraphProjection {
  readonly nodes: readonly WorkGraphNode[];
  readonly edges: readonly WorkGraphEdge[];
  findNode(id: string): WorkGraphNode | undefined;
  getNodesByType(type: WorkGraphNodeType): WorkGraphNode[];
  getEdgesByType(type: WorkGraphEdgeType): WorkGraphEdge[];
  getOutgoingEdges(nodeId: string): WorkGraphEdge[];
  getIncomingEdges(nodeId: string): WorkGraphEdge[];
}

export interface ProjectWorkGraphOptions {
  rootDir?: string;
  workspaceDirs?: string[];
}

interface MarkdownDocument {
  filePath: string;
  relativePath: string;
  frontmatter: JsonObject;
  body: string;
}

interface ResolvedDocument {
  document: MarkdownDocument;
  nodeId: string;
  nodeType: WorkGraphNodeType;
}

interface GraphIndex {
  nodes: WorkGraphNode[];
  edges: WorkGraphEdge[];
  nodeById: Map<string, WorkGraphNode>;
  nodeByType: Map<WorkGraphNodeType, WorkGraphNode[]>;
  edgeByType: Map<WorkGraphEdgeType, WorkGraphEdge[]>;
  outgoingByNodeId: Map<string, WorkGraphEdge[]>;
  incomingByNodeId: Map<string, WorkGraphEdge[]>;
}

const DEFAULT_WORKSPACE_DIRS = ["backlog", "docs"];
const WORK_ITEM_PARENT_EDGE_TYPES = new Map<string, WorkGraphEdgeType>([
  ["part_of", "belongs_to"],
  ["belongs_to", "belongs_to"],
]);
const TRACEABILITY_EDGE_TYPES = new Map<string, WorkGraphEdgeType>([
  ["implements", "implements"],
]);

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function asArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function stripWikiLink(value: string): string {
  const trimmed = value.trim();
  const withoutBrackets = trimmed.replace(/^\[\[/, "").replace(/\]\]$/, "");
  return withoutBrackets.split("|", 1)[0]?.split("#", 1)[0]?.trim() ?? "";
}

function stripMarkdownExtension(value: string): string {
  return value.replace(/\.md$/i, "");
}

function normalizeReferenceToken(value: string): string {
  const stripped = stripMarkdownExtension(stripWikiLink(value));
  const base = path.posix.basename(stripped);
  return normalizeText(base);
}

function documentAliases(frontmatter: JsonObject, relativePath: string): string[] {
  const id = asString(frontmatter.id);
  const basename = normalizeReferenceToken(relativePath);
  const basenameWithoutExt = normalizeReferenceToken(path.basename(relativePath));
  const idToken = id ? normalizeText(id) : undefined;
  const shortFormId = id ? normalizeText(id.replace(/:/g, "-")) : undefined;
  const workItemShortForm = id?.startsWith("wi:")
    ? `wi-${id.slice(3)}`
    : undefined;

  return unique(
    [
      idToken,
      shortFormId,
      workItemShortForm,
      basename,
      basenameWithoutExt,
      normalizeText(stripMarkdownExtension(relativePath)),
      normalizeText(path.basename(relativePath)),
    ].filter((entry): entry is string => Boolean(entry && entry.length > 0)),
  );
}

function parseRelationships(body: string): Array<{
  sourceKey: string;
  target: string;
}> {
  const headingRegex = /^##\s+Relationships\s*$/gim;
  const headingMatch = headingRegex.exec(body);
  if (!headingMatch) {
    return [];
  }

  const sectionStart = headingMatch.index + headingMatch[0].length;
  const nextHeadingMatch = body.slice(sectionStart).match(/\n##\s+/);
  const sectionEnd =
    nextHeadingMatch && nextHeadingMatch.index !== undefined
      ? sectionStart + nextHeadingMatch.index
      : body.length;
  const section = body.slice(sectionStart, sectionEnd);

  return section
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s*`([^`]+)`:\s*(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      sourceKey: (match[1] ?? "").trim().toLowerCase(),
      target: (match[2] ?? "").trim(),
    }))
    .filter((entry) => entry.sourceKey.length > 0 && entry.target.length > 0);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectMarkdownFiles(dirPath: string): Promise<string[]> {
  if (!(await pathExists(dirPath))) {
    return [];
  }

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files.sort((a, b) => toPosixPath(a).localeCompare(toPosixPath(b)));
}

async function readMarkdownDocuments(
  rootDir: string,
  workspaceDirs: string[],
): Promise<MarkdownDocument[]> {
  const documents: MarkdownDocument[] = [];
  for (const workspaceDir of workspaceDirs) {
    const dirPath = path.resolve(rootDir, workspaceDir);
    const files = await collectMarkdownFiles(dirPath);
    for (const filePath of files) {
      const relativePath = toPosixPath(path.relative(rootDir, filePath));
      if (relativePath.startsWith("backlog/audit/")) {
        continue;
      }
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = matter(raw);
      documents.push({
        filePath,
        relativePath,
        frontmatter: (parsed.data ?? {}) as JsonObject,
        body: parsed.content,
      });
    }
  }
  return documents;
}

function isWorkItemDocument(document: MarkdownDocument): boolean {
  return asString(document.frontmatter.type) === "work-item";
}

function isRecordDocument(document: MarkdownDocument): boolean {
  return asString(document.frontmatter.type) === "record";
}

function isProjectlikeDocument(document: MarkdownDocument): boolean {
  const type = asString(document.frontmatter.type);
  return (
    type === "project" ||
    type === "release" ||
    type === "milestone" ||
    type === "plan" ||
    type === "prd" ||
    type === "adr" ||
    type === "requirement" ||
    type === "decision"
  );
}

function canonicalWorkItemNodeId(value: string): string {
  return canonicalizeWorkItemScopeRef(value);
}

function canonicalScopeNodeId(value: string): string {
  return canonicalizeScopeRef(value);
}

function createWorkItemNode(document: MarkdownDocument): WorkGraphNode | undefined {
  const id = asString(document.frontmatter.id);
  const title = asString(document.frontmatter.title) ?? id;
  if (!id || !title) {
    return undefined;
  }
  const nodeId = canonicalWorkItemNodeId(id);
  return {
    id: nodeId,
    type: "work-item",
    stableId: nodeId,
    label: title,
    source: {
      kind: "work-item",
      filePath: document.relativePath,
    },
    properties: {
      entityType: "work-item",
      frontmatterId: id,
      status: asString(document.frontmatter.status),
      lifecycle: asString(document.frontmatter.lifecycle),
      subtype: asString(document.frontmatter.subtype),
      summary: asString(document.frontmatter.summary),
    },
  };
}

function createRecordNode(document: MarkdownDocument): WorkGraphNode | undefined {
  const id = asString(document.frontmatter.id);
  const title = asString(document.frontmatter.title) ?? id;
  if (!id || !title) {
    return undefined;
  }
  const stableId = id.startsWith("record:") ? id : `record:${id}`;
  return {
    id: stableId,
    type: "record",
    stableId,
    label: title,
    source: {
      kind: "record",
      filePath: document.relativePath,
    },
    properties: {
      entityType: "record",
      frontmatterId: id,
      subtype: asString(document.frontmatter.subtype),
      summary: asString(document.frontmatter.summary),
    },
  };
}

function createScopeNode(options: {
  id: string;
  label: string;
  filePath?: string;
  originType?: string;
  properties?: JsonObject;
}): WorkGraphNode {
  return {
    id: `scope:${options.id}`,
    type: "scope",
    stableId: options.id,
    label: options.label,
    source: {
      kind: "scope",
      filePath: options.filePath,
    },
    properties: {
      entityType: "scope",
      originType: options.originType,
      ...options.properties,
    },
  };
}

function createClaimNode(record: RuntimeClaimRecord): WorkGraphNode {
  return {
    id: `claim:${record.claim_token}`,
    type: "claim",
    stableId: record.claim_token,
    label: record.holder,
    source: {
      kind: "claim",
      claimToken: record.claim_token,
    },
    properties: {
      entityType: "claim",
      claimToken: record.claim_token,
      targetType: record.target_type,
      targetId: record.target_id,
      holder: record.holder,
      state: record.state,
      createdAt: record.created_at,
      expiresAt: record.expires_at,
      lastSeenAt: record.last_seen_at,
    },
  };
}

function createClaimScopeNode(record: RuntimeClaimRecord): WorkGraphNode {
  return createScopeNode({
    id: normalizeClaimScopeRef(record),
    label: normalizeClaimScopeRef(record),
    originType: record.target_type,
    properties: {
      claimToken: record.claim_token,
      targetType: record.target_type,
      targetId: record.target_id,
      state: record.state,
    },
  });
}

function normalizeClaimScopeRef(record: RuntimeClaimRecord): string {
  const targetType = normalizeText(record.target_type);
  if (targetType === "task" || targetType === "work-item" || targetType === "wi") {
    return canonicalWorkItemNodeId(record.target_id);
  }
  return canonicalScopeNodeId(`${record.target_type}:${record.target_id}`);
}

function normalizeTargetReference(reference: string): string {
  const stripped = stripWikiLink(reference);
  const candidate = stripMarkdownExtension(stripped);
  return normalizeText(path.posix.basename(candidate));
}

function resolveDocument(
  reference: string,
  documents: MarkdownDocument[],
  aliases: Map<string, ResolvedDocument>,
): ResolvedDocument | undefined {
  const normalizedReference = normalizeTargetReference(reference);
  const direct = aliases.get(normalizedReference);
  if (direct) {
    return direct;
  }

  const normalizedWikiReference = normalizeText(stripMarkdownExtension(stripWikiLink(reference)));
  const byId = aliases.get(normalizedWikiReference);
  if (byId) {
    return byId;
  }

  const rawBase = normalizeText(path.posix.basename(stripMarkdownExtension(stripWikiLink(reference))));
  const byBase = aliases.get(rawBase);
  if (byBase) {
    return byBase;
  }

  const exact = documents.find((document) => {
    const id = asString(document.frontmatter.id);
    return Boolean(
      id &&
        [
          normalizeText(id),
          normalizeText(id.replace(/:/g, "-")),
          normalizeText(path.posix.basename(document.relativePath)),
          normalizeText(stripMarkdownExtension(path.posix.basename(document.relativePath))),
        ].includes(normalizedReference),
    );
  });
  if (!exact) {
    return undefined;
  }
  return {
    document: exact,
    nodeId: isWorkItemDocument(exact)
      ? canonicalWorkItemNodeId(asString(exact.frontmatter.id) ?? "")
      : isRecordDocument(exact)
        ? `record:${asString(exact.frontmatter.id)}`
        : `scope:${asString(exact.frontmatter.id)}`,
    nodeType: isWorkItemDocument(exact)
      ? "work-item"
      : isRecordDocument(exact)
        ? "record"
        : "scope",
  };
}

function createEdge(
  from: WorkGraphNode,
  to: WorkGraphNode,
  type: WorkGraphEdgeType,
  source: WorkGraphEdge["source"],
  properties: JsonObject,
): WorkGraphEdge {
  return {
    id: `${from.id}::${type}::${to.id}`,
    type,
    from: from.id,
    to: to.id,
    direction: "authored",
    source,
    properties,
  };
}

function mapRelationshipType(sourceKey: string): WorkGraphEdgeType | undefined {
  return WORK_ITEM_PARENT_EDGE_TYPES.get(sourceKey) ?? TRACEABILITY_EDGE_TYPES.get(sourceKey) ?? (sourceKey === "depends_on" ? "depends_on" : undefined);
}

function buildGraphIndex(nodes: WorkGraphNode[], edges: WorkGraphEdge[]): GraphIndex {
  const nodeById = new Map<string, WorkGraphNode>();
  const nodeByType = new Map<WorkGraphNodeType, WorkGraphNode[]>();
  const edgeByType = new Map<WorkGraphEdgeType, WorkGraphEdge[]>();
  const outgoingByNodeId = new Map<string, WorkGraphEdge[]>();
  const incomingByNodeId = new Map<string, WorkGraphEdge[]>();

  const sortedNodes = [...nodes].sort((left, right) => {
    const typeRank = (type: WorkGraphNodeType): number => {
      switch (type) {
        case "work-item":
          return 0;
        case "claim":
          return 1;
        case "record":
          return 2;
        case "scope":
          return 3;
      }
    };
    return (
      typeRank(left.type) - typeRank(right.type) ||
      left.id.localeCompare(right.id)
    );
  });

  const dedupedEdges = new Map<string, WorkGraphEdge>();
  for (const edge of edges) {
    dedupedEdges.set(edge.id, edge);
  }

  const sortedEdges = [...dedupedEdges.values()].sort((left, right) =>
    left.type.localeCompare(right.type) ||
    left.from.localeCompare(right.from) ||
    left.to.localeCompare(right.to),
  );

  for (const node of sortedNodes) {
    nodeById.set(node.id, node);
    const list = nodeByType.get(node.type) ?? [];
    list.push(node);
    nodeByType.set(node.type, list);
  }

  for (const edge of sortedEdges) {
    const list = edgeByType.get(edge.type) ?? [];
    list.push(edge);
    edgeByType.set(edge.type, list);

    const outgoing = outgoingByNodeId.get(edge.from) ?? [];
    outgoing.push(edge);
    outgoingByNodeId.set(edge.from, outgoing);

    const incoming = incomingByNodeId.get(edge.to) ?? [];
    incoming.push(edge);
    incomingByNodeId.set(edge.to, incoming);
  }

  return {
    nodes: sortedNodes,
    edges: sortedEdges,
    nodeById,
    nodeByType,
    edgeByType,
    outgoingByNodeId,
    incomingByNodeId,
  };
}

function createProjectionView(index: GraphIndex): WorkGraphProjection {
  return {
    nodes: index.nodes,
    edges: index.edges,
    findNode(id: string): WorkGraphNode | undefined {
      return index.nodeById.get(id);
    },
    getNodesByType(type: WorkGraphNodeType): WorkGraphNode[] {
      return [...(index.nodeByType.get(type) ?? [])];
    },
    getEdgesByType(type: WorkGraphEdgeType): WorkGraphEdge[] {
      return [...(index.edgeByType.get(type) ?? [])];
    },
    getOutgoingEdges(nodeId: string): WorkGraphEdge[] {
      return [...(index.outgoingByNodeId.get(nodeId) ?? [])];
    },
    getIncomingEdges(nodeId: string): WorkGraphEdge[] {
      return [...(index.incomingByNodeId.get(nodeId) ?? [])];
    },
  };
}

function projectRelationshipEdges(options: {
  document: MarkdownDocument;
  sourceNode: WorkGraphNode;
  documents: MarkdownDocument[];
  aliases: Map<string, ResolvedDocument>;
  nodesById: Map<string, WorkGraphNode>;
  edges: WorkGraphEdge[];
  ensureScopeNode: (target: WorkGraphNode) => void;
}): void {
  const links =
    typeof options.document.frontmatter.links === "object" &&
    options.document.frontmatter.links !== null
      ? (options.document.frontmatter.links as JsonObject)
      : {};
  const frontmatterDependsOn = asArray(links.depends_on);
  for (const target of frontmatterDependsOn) {
    const resolved = resolveDocument(target, options.documents, options.aliases);
    if (!resolved) {
      continue;
    }
    const targetNode =
      options.nodesById.get(resolved.nodeId) ??
      (resolved.nodeType === "scope"
        ? createScopeNode({
            id: resolved.nodeId.replace(/^scope:/, ""),
            label: asString(resolved.document.frontmatter.title) ?? resolved.nodeId,
            filePath: resolved.document.relativePath,
            originType: asString(resolved.document.frontmatter.type),
            properties: {
              frontmatterId: asString(resolved.document.frontmatter.id),
            },
          })
        : undefined);
    if (!targetNode) {
      continue;
    }
    options.ensureScopeNode(targetNode);
    options.edges.push(
      createEdge(
        options.sourceNode,
        targetNode,
        "depends_on",
        {
          kind: "frontmatter",
          filePath: options.document.relativePath,
        },
        {
          rawTarget: target,
          frontmatterId: asString(options.document.frontmatter.id),
        },
      ),
    );
  }

  for (const relationship of parseRelationships(options.document.body)) {
    const mappedType = mapRelationshipType(relationship.sourceKey);
    if (!mappedType) {
      continue;
    }
    if (relationship.sourceKey === "blocks" || relationship.sourceKey === "relates_to") {
      continue;
    }

    const resolved = resolveDocument(
      relationship.target,
      options.documents,
      options.aliases,
    );
    if (!resolved) {
      continue;
    }

    const targetNode =
      options.nodesById.get(resolved.nodeId) ??
      (resolved.nodeType === "scope"
        ? createScopeNode({
            id: resolved.nodeId.replace(/^scope:/, ""),
            label: asString(resolved.document.frontmatter.title) ?? resolved.nodeId,
            filePath: resolved.document.relativePath,
            originType: asString(resolved.document.frontmatter.type),
            properties: {
              frontmatterId: asString(resolved.document.frontmatter.id),
            },
          })
        : undefined);
    if (!targetNode) {
      continue;
    }
    options.ensureScopeNode(targetNode);
    options.edges.push(
      createEdge(
        options.sourceNode,
        targetNode,
        mappedType,
        {
          kind: "relationships",
          filePath: options.document.relativePath,
        },
        {
          rawTarget: relationship.target,
          relationship: relationship.sourceKey,
        },
      ),
    );
  }
}

export async function projectWorkGraph(
  options: ProjectWorkGraphOptions = {},
): Promise<WorkGraphProjection> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const workspaceDirs = options.workspaceDirs ?? DEFAULT_WORKSPACE_DIRS;
  const documents = await readMarkdownDocuments(rootDir, workspaceDirs);
  const nodes: WorkGraphNode[] = [];
  const edges: WorkGraphEdge[] = [];
  const nodesById = new Map<string, WorkGraphNode>();
  const aliases = new Map<string, ResolvedDocument>();
  const scopeNodeIds = new Set<string>();

  for (const document of documents) {
    const id = asString(document.frontmatter.id);
    if (!id) {
      continue;
    }
    const resolved: ResolvedDocument | undefined = isWorkItemDocument(document)
      ? {
          document,
          nodeId: canonicalWorkItemNodeId(id),
          nodeType: "work-item",
        }
      : isRecordDocument(document)
        ? {
            document,
            nodeId: `record:${id}`,
            nodeType: "record",
          }
        : isProjectlikeDocument(document)
          ? {
              document,
              nodeId: `scope:${canonicalScopeNodeId(id)}`,
              nodeType: "scope",
            }
          : undefined;

    for (const alias of documentAliases(document.frontmatter, document.relativePath)) {
      aliases.set(alias, {
        document,
        nodeId: resolved?.nodeId ?? `scope:${canonicalScopeNodeId(id)}`,
        nodeType: resolved?.nodeType ?? "scope",
      });
    }

    if (!resolved) {
      continue;
    }

    const node =
      resolved.nodeType === "work-item"
        ? createWorkItemNode(document)
        : resolved.nodeType === "record"
          ? createRecordNode(document)
          : createScopeNode({
              id,
              label: asString(document.frontmatter.title) ?? id,
              filePath: document.relativePath,
              originType: asString(document.frontmatter.type),
              properties: {
                frontmatterId: id,
                summary: asString(document.frontmatter.summary),
              },
            });

    if (!node || nodesById.has(node.id)) {
      continue;
    }

    nodes.push(node);
    nodesById.set(node.id, node);

    if (node.type === "work-item") {
      const scopeId = node.id;
      if (!scopeNodeIds.has(scopeId)) {
        const scopeNode = createScopeNode({
          id: scopeId,
          label: node.label,
          filePath: document.relativePath,
          originType: "work-item",
          properties: {
            frontmatterId: id,
          },
        });
        nodes.push(scopeNode);
        nodesById.set(scopeNode.id, scopeNode);
        scopeNodeIds.add(scopeId);
      }
    }
  }

  const runtimeStore = openRuntimeSqliteStore({ rootDir });
  try {
    for (const claim of runtimeStore.listClaims()) {
      const claimNode = createClaimNode(claim);
      if (!nodesById.has(claimNode.id)) {
        nodes.push(claimNode);
        nodesById.set(claimNode.id, claimNode);
      }
      const scopeNode = createClaimScopeNode(claim);
      if (!nodesById.has(scopeNode.id)) {
        nodes.push(scopeNode);
        nodesById.set(scopeNode.id, scopeNode);
      }
      if (!scopeNodeIds.has(scopeNode.id)) {
        scopeNodeIds.add(scopeNode.id);
      }
      edges.push(
        createEdge(
          claimNode,
          scopeNode,
          "belongs_to",
          {
            kind: "runtime",
            claimToken: claim.claim_token,
          },
          {
            targetType: claim.target_type,
            targetId: claim.target_id,
            state: claim.state,
          },
        ),
      );
    }
  } finally {
    runtimeStore.close();
  }

  for (const document of documents) {
    const id = asString(document.frontmatter.id);
    if (!id) {
      continue;
    }
    const sourceNode = nodesById.get(
      isWorkItemDocument(document)
        ? canonicalWorkItemNodeId(id)
        : isRecordDocument(document)
          ? `record:${id}`
          : `scope:${canonicalScopeNodeId(id)}`,
    );
    if (!sourceNode || sourceNode.type !== "work-item") {
      continue;
    }
    projectRelationshipEdges({
      document,
      sourceNode,
      documents,
      aliases,
      nodesById,
      edges,
      ensureScopeNode(targetNode: WorkGraphNode) {
        if (targetNode.type !== "scope") {
          return;
        }
        if (!nodesById.has(targetNode.id)) {
          nodes.push(targetNode);
          nodesById.set(targetNode.id, targetNode);
        }
        scopeNodeIds.add(targetNode.id);
      },
    });
  }

  return createProjectionView(buildGraphIndex(nodes, edges));
}

export async function createWorkProjectionPort(
  options: ProjectWorkGraphOptions = {},
): Promise<WorkGraphProjection> {
  return projectWorkGraph(options);
}

export async function createProjectionPort(
  options: ProjectWorkGraphOptions = {},
): Promise<WorkGraphProjection> {
  return projectWorkGraph(options);
}

export async function projectRepositoryGraph(
  options: ProjectWorkGraphOptions = {},
): Promise<WorkGraphProjection> {
  return projectWorkGraph(options);
}
