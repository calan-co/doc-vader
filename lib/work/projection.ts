import matter from "gray-matter";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type RuntimeClaimRecord,
  type RuntimeScopeLockRecord,
} from "../runtime/index.js";
import { canonicalizeScopeRef, canonicalizeWorkItemScopeRef } from "./scope-ref.js";

type JsonObject = Record<string, unknown>;

export type WorkGraphNodeType = "work-item" | "claim" | "record" | "scope";

export type WorkGraphEdgeType =
  | "depends_on"
  | "belongs_to"
  | "implements"
  | "locks"
  | "records"
  | "references";

export type WorkGraphEdgeAuthority = "formal" | "informational";

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
  authority: WorkGraphEdgeAuthority;
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
  readonly diagnostics: readonly WorkGraphProjectionDiagnostic[];
  findNode(id: string): WorkGraphNode | undefined;
  getNodesByType(type: WorkGraphNodeType): WorkGraphNode[];
  getEdgesByType(type: WorkGraphEdgeType): WorkGraphEdge[];
  getOutgoingEdges(nodeId: string): WorkGraphEdge[];
  getIncomingEdges(nodeId: string): WorkGraphEdge[];
}

export type WorkGraphProjectionDiagnosticClassification =
  | "skipped"
  | "unsupported";

export type WorkGraphProjectionDiagnosticReasonCode =
  | "missing-document-id"
  | "non-canonical-document-id"
  | "unsupported-document-type";

export interface WorkGraphProjectionDiagnostic {
  classification: WorkGraphProjectionDiagnosticClassification;
  relativePath: string;
  documentId?: string;
  reasonCode: WorkGraphProjectionDiagnosticReasonCode;
}

export interface ProjectWorkGraphOptions {
  rootDir?: string;
  workspaceDirs?: string[];
  runtimeState?: RuntimeProjectionState;
}

export interface RuntimeProjectionState {
  claims: RuntimeClaimRecord[];
  scopeLocks: RuntimeScopeLockRecord[];
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

interface ClassifiedDocument {
  document: MarkdownDocument;
  documentId?: string;
  classification: "projectable" | WorkGraphProjectionDiagnosticClassification;
  resolved?: ResolvedDocument;
  diagnostic?: WorkGraphProjectionDiagnostic;
}

interface ProjectableDocument extends ClassifiedDocument {
  documentId: string;
  classification: "projectable";
  resolved: ResolvedDocument;
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
const NODE_TYPE_SORT_ORDER: Record<WorkGraphNodeType, number> = {
  "work-item": 0,
  claim: 1,
  record: 2,
  scope: 3,
};

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

function asLinkTarget(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const ref = asString(record.ref);
  if (ref) {
    return ref;
  }
  return asString(record.link);
}

function asLinkArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asLinkTarget(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

const FORMAL_FRONTMATTER_LINK_KEYS = new Set(["depends_on", "evidence"]);

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
  const section = findMarkdownSection(body, "Relationships");
  if (!section) {
    return [];
  }

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

function findMarkdownSection(body: string, heading: string): string | undefined {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingRegex = new RegExp(`^##\\s+${escapedHeading}\\s*$`, "gim");
  const headingMatch = headingRegex.exec(body);
  if (!headingMatch) {
    return undefined;
  }

  const sectionStart = headingMatch.index + headingMatch[0].length;
  const nextHeadingMatch = body.slice(sectionStart).match(/\n##\s+/);
  const sectionEnd =
    nextHeadingMatch && nextHeadingMatch.index !== undefined
      ? sectionStart + nextHeadingMatch.index
      : body.length;
  return body.slice(sectionStart, sectionEnd);
}

function parseSectionBulletValues(body: string, heading: string): string[] {
  const section = findMarkdownSection(body, heading);
  if (!section) {
    return [];
  }

  return section
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => (match[1] ?? "").trim())
    .filter((value) => value.length > 0);
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
  const scopeId = normalizeClaimScopeRef(record);
  return createScopeNode({
    id: scopeId,
    label: scopeId,
    originType: record.target_type,
    properties: {
      claimToken: record.claim_token,
      targetType: record.target_type,
      targetId: record.target_id,
      state: record.state,
    },
  });
}

function createRuntimeLockScopeNode(scopeRef: string): WorkGraphNode {
  return createScopeNode({
    id: canonicalScopeNodeId(scopeRef),
    label: scopeRef,
    properties: {
      scopeRef,
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

function resolveDocumentKind(document: MarkdownDocument): WorkGraphNodeType | undefined {
  if (isWorkItemDocument(document)) {
    return "work-item";
  }
  if (isRecordDocument(document)) {
    return "record";
  }
  if (isProjectlikeDocument(document)) {
    return "scope";
  }
  return undefined;
}

function resolveDocumentNodeId(
  document: MarkdownDocument,
  kind: WorkGraphNodeType | undefined,
  id: string,
): string {
  switch (kind) {
    case "work-item":
      return canonicalWorkItemNodeId(id);
    case "record":
      return id.startsWith("record:") ? id : `record:${id}`;
    case "scope":
    default:
      return `scope:${canonicalScopeNodeId(id)}`;
  }
}

function createNodeFromDocument(
  document: MarkdownDocument,
  kind: WorkGraphNodeType,
): WorkGraphNode | undefined {
  switch (kind) {
    case "work-item":
      return createWorkItemNode(document);
    case "record":
      return createRecordNode(document);
    case "scope": {
      const id = asString(document.frontmatter.id);
      if (!id) {
        return undefined;
      }
      return createScopeNode({
        id,
        label: asString(document.frontmatter.title) ?? id,
        filePath: document.relativePath,
        originType: asString(document.frontmatter.type),
        properties: {
          frontmatterId: id,
          summary: asString(document.frontmatter.summary),
        },
      });
    }
  }
}

function resolveDocumentNode(
  document: MarkdownDocument,
): ResolvedDocument | undefined {
  const id = asString(document.frontmatter.id);
  if (!id) {
    return undefined;
  }

  const kind = resolveDocumentKind(document);
  if (!kind) {
    return undefined;
  }

  return {
    document,
    nodeId: resolveDocumentNodeId(document, kind, id),
    nodeType: kind,
  };
}

function safelyResolveDocumentNode(
  document: MarkdownDocument,
): ResolvedDocument | undefined {
  try {
    return resolveDocumentNode(document);
  } catch {
    return undefined;
  }
}

function createProjectionDiagnostic(options: {
  classification: WorkGraphProjectionDiagnosticClassification;
  document: MarkdownDocument;
  reasonCode: WorkGraphProjectionDiagnosticReasonCode;
  documentId?: string;
}): WorkGraphProjectionDiagnostic {
  return {
    classification: options.classification,
    relativePath: options.document.relativePath,
    documentId: options.documentId,
    reasonCode: options.reasonCode,
  };
}

// Keep helper and policy documents observable during live scans without
// coercing them into MVP graph nodes.
function classifyDocument(document: MarkdownDocument): ClassifiedDocument {
  const documentId = asString(document.frontmatter.id);
  if (!documentId) {
    return {
      document,
      classification: "skipped",
      diagnostic: createProjectionDiagnostic({
        classification: "skipped",
        reasonCode: "missing-document-id",
        document,
      }),
    };
  }

  const resolved = safelyResolveDocumentNode(document);
  if (resolved === undefined && resolveDocumentKind(document)) {
    return {
      document,
      documentId,
      classification: "unsupported",
      diagnostic: createProjectionDiagnostic({
        classification: "unsupported",
        reasonCode: "non-canonical-document-id",
        document,
        documentId,
      }),
    };
  }

  if (!resolved) {
    return {
      document,
      documentId,
      classification: "unsupported",
      diagnostic: createProjectionDiagnostic({
        classification: "unsupported",
        reasonCode: "unsupported-document-type",
        document,
        documentId,
      }),
    };
  }

  return {
    document,
    documentId,
    classification: "projectable",
    resolved,
  };
}

function isProjectableDocument(
  document: ClassifiedDocument,
): document is ProjectableDocument {
  return document.classification === "projectable";
}

function createResolvedTargetNode(
  resolved: ResolvedDocument,
  nodesById: Map<string, WorkGraphNode>,
): WorkGraphNode | undefined {
  const existing = nodesById.get(resolved.nodeId);
  if (existing) {
    return existing;
  }
  if (resolved.nodeType !== "scope") {
    return undefined;
  }
  const id = resolved.nodeId.replace(/^scope:/, "");
  const title = asString(resolved.document.frontmatter.title) ?? resolved.nodeId;
  return createScopeNode({
    id,
    label: title,
    filePath: resolved.document.relativePath,
    originType: asString(resolved.document.frontmatter.type),
    properties: {
      frontmatterId: asString(resolved.document.frontmatter.id),
    },
  });
}

function ensureScopeNode(
  targetNode: WorkGraphNode,
  nodes: WorkGraphNode[],
  nodesById: Map<string, WorkGraphNode>,
  scopeNodeIds: Set<string>,
): void {
  if (targetNode.type !== "scope") {
    return;
  }
  if (!nodesById.has(targetNode.id)) {
    nodes.push(targetNode);
    nodesById.set(targetNode.id, targetNode);
  }
  scopeNodeIds.add(targetNode.id);
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
  return safelyResolveDocumentNode(exact);
}

function getFrontmatterLinks(frontmatter: JsonObject): JsonObject {
  return typeof frontmatter.links === "object" && frontmatter.links !== null
    ? (frontmatter.links as JsonObject)
    : {};
}

function getRecordKind(node: WorkGraphNode): string {
  return typeof node.properties.subtype === "string"
    ? node.properties.subtype
    : "record";
}

function createEdge(
  from: WorkGraphNode,
  to: WorkGraphNode,
  type: WorkGraphEdgeType,
  authority: WorkGraphEdgeAuthority,
  source: WorkGraphEdge["source"],
  properties: JsonObject,
): WorkGraphEdge {
  return {
    id: `${from.id}::${type}::${to.id}`,
    type,
    authority,
    from: from.id,
    to: to.id,
    direction: "authored",
    source,
    properties,
  };
}

function edgeProvenanceSuffix(edge: WorkGraphEdge): string {
  const sourceKey =
    typeof edge.properties.sourceKey === "string"
      ? edge.properties.sourceKey
      : "edge";
  const rawTarget =
    typeof edge.properties.rawTarget === "string"
      ? edge.properties.rawTarget
      : edge.to;
  const sourceFile =
    typeof edge.source.filePath === "string"
      ? edge.source.filePath
      : edge.source.claimToken ?? edge.source.kind;
  return `${edge.source.kind}::${sourceFile}::${sourceKey}::${rawTarget}`;
}

function disambiguateEdgeIds(edges: WorkGraphEdge[]): WorkGraphEdge[] {
  const idCounts = new Map<string, number>();
  const lastIndexById = new Map<string, number>();
  edges.forEach((edge, index) => {
    idCounts.set(edge.id, (idCounts.get(edge.id) ?? 0) + 1);
    lastIndexById.set(edge.id, index);
  });

  const seen = new Map<string, number>();
  return edges.map((edge, index) => {
    if (
      (idCounts.get(edge.id) ?? 0) === 1 ||
      lastIndexById.get(edge.id) === index
    ) {
      return edge;
    }

    const suffix = edgeProvenanceSuffix(edge);
    const duplicateKey = `${edge.id}::${suffix}`;
    const duplicateIndex = seen.get(duplicateKey) ?? 0;
    seen.set(duplicateKey, duplicateIndex + 1);
    const uniqueId =
      duplicateIndex === 0 ? duplicateKey : `${duplicateKey}::${duplicateIndex + 1}`;
    return { ...edge, id: uniqueId };
  });
}

function mapRelationshipType(sourceKey: string): WorkGraphEdgeType | undefined {
  const mappedParent = WORK_ITEM_PARENT_EDGE_TYPES.get(sourceKey);
  if (mappedParent) {
    return mappedParent;
  }
  const mappedTraceability = TRACEABILITY_EDGE_TYPES.get(sourceKey);
  if (mappedTraceability) {
    return mappedTraceability;
  }
  switch (sourceKey) {
    case "depends_on":
      return "depends_on";
    default:
      return undefined;
  }
}

function buildGraphIndex(nodes: WorkGraphNode[], edges: WorkGraphEdge[]): GraphIndex {
  const nodeById = new Map<string, WorkGraphNode>();
  const nodeByType = new Map<WorkGraphNodeType, WorkGraphNode[]>();
  const edgeByType = new Map<WorkGraphEdgeType, WorkGraphEdge[]>();
  const outgoingByNodeId = new Map<string, WorkGraphEdge[]>();
  const incomingByNodeId = new Map<string, WorkGraphEdge[]>();

  const sortedNodes = [...nodes].sort((left, right) =>
    NODE_TYPE_SORT_ORDER[left.type] - NODE_TYPE_SORT_ORDER[right.type] ||
    left.id.localeCompare(right.id),
  );

  const sortedEdges = disambiguateEdgeIds(edges).sort((left, right) =>
    left.type.localeCompare(right.type) ||
    left.from.localeCompare(right.from) ||
    left.to.localeCompare(right.to) ||
    left.id.localeCompare(right.id),
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

function createProjectionView(
  index: GraphIndex,
  diagnostics: WorkGraphProjectionDiagnostic[],
): WorkGraphProjection {
  const sortedDiagnostics = [...diagnostics].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath) ||
    (left.documentId ?? "").localeCompare(right.documentId ?? "") ||
    left.reasonCode.localeCompare(right.reasonCode),
  );

  return {
    nodes: index.nodes,
    edges: index.edges,
    diagnostics: sortedDiagnostics,
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

function parseJsonObject(
  value: unknown,
): Record<string, unknown> | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function toReadonlyRuntimeClaimRecord(
  row: Record<string, unknown>,
): RuntimeClaimRecord {
  const metadata = parseJsonObject(row.metadata);
  return {
    schema_version: row.schema_version as RuntimeClaimRecord["schema_version"],
    claim_token: row.claim_token as string,
    target_type: row.target_type as string,
    target_id: row.target_id as string,
    holder: row.holder as string,
    created_at: row.created_at as string,
    expires_at: row.expires_at as string,
    ...(typeof row.last_seen_at === "string"
      ? { last_seen_at: row.last_seen_at as string }
      : {}),
    ...(metadata ? { metadata } : {}),
    state: row.state === "expired" ? "expired" : "active",
  };
}

function toReadonlyRuntimeScopeLockRecord(
  row: Record<string, unknown>,
): RuntimeScopeLockRecord {
  const metadata = parseJsonObject(row.metadata);
  return {
    schema_version: row.schema_version as RuntimeScopeLockRecord["schema_version"],
    claim_token: row.claim_token as string,
    scope_ref: row.scope_ref as string,
    lock_mode: row.lock_mode as RuntimeScopeLockRecord["lock_mode"],
    policy_name: row.policy_name as RuntimeScopeLockRecord["policy_name"],
    acquired_at: row.acquired_at as string,
    updated_at: row.updated_at as string,
    lifecycle_state: row.lifecycle_state as RuntimeScopeLockRecord["lifecycle_state"],
    ...(typeof row.released_at === "string"
      ? { released_at: row.released_at as string }
      : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function hasDatabaseObject(database: DatabaseSync, objectName: string): boolean {
  const row = database
    .prepare(
      `SELECT 1
         FROM sqlite_master
        WHERE type IN ('table', 'view')
          AND name = ?
        LIMIT 1`,
    )
    .get(objectName) as Record<string, unknown> | undefined;
  return Boolean(row);
}

function readRuntimeProjectionState(rootDir: string): RuntimeProjectionState {
  const databasePath = path.join(rootDir, ".doc-vader", "runtime", "runtime.sqlite");
  if (!existsSync(databasePath)) {
    return { claims: [], scopeLocks: [] };
  }

  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const claims = hasDatabaseObject(database, "runtime_claims")
      ? (database.prepare(
          `SELECT * FROM runtime_claims ORDER BY created_at, claim_token`,
        ).all() as Record<string, unknown>[])
          .map(toReadonlyRuntimeClaimRecord)
      : [];
    const scopeLocks = hasDatabaseObject(database, "claim_scope_locks")
      ? (database.prepare(
          `SELECT * FROM claim_scope_locks
           ORDER BY acquired_at, scope_ref, lock_mode`,
        ).all() as Record<string, unknown>[])
          .map(toReadonlyRuntimeScopeLockRecord)
      : [];
    return { claims, scopeLocks };
  } finally {
    database?.close();
  }
}

function createRuntimeLockEdgeProperties(
  scopeLock: RuntimeScopeLockRecord,
  claim: RuntimeClaimRecord,
  resolvedTargetId: string,
): JsonObject {
  return {
    sourceKey: "scope_lock",
    rawTarget: scopeLock.scope_ref,
    resolvedTargetId,
    claimToken: scopeLock.claim_token,
    scopeRef: scopeLock.scope_ref,
    lockMode: scopeLock.lock_mode,
    policyName: scopeLock.policy_name,
    acquiredAt: scopeLock.acquired_at,
    updatedAt: scopeLock.updated_at,
    lifecycleState: scopeLock.lifecycle_state,
    releasedAt: scopeLock.released_at,
    targetType: claim.target_type,
    targetId: claim.target_id,
    claimState: claim.state,
  };
}

function ensureRuntimeLockScopeNode(
  scopeRef: string,
  nodes: WorkGraphNode[],
  nodesById: Map<string, WorkGraphNode>,
  scopeNodeIds: Set<string>,
): WorkGraphNode {
  const scopeNodeId = `scope:${canonicalScopeNodeId(scopeRef)}`;
  let scopeNode = nodesById.get(scopeNodeId);

  if (!scopeNode) {
    scopeNode = createRuntimeLockScopeNode(scopeRef);
    nodes.push(scopeNode);
    nodesById.set(scopeNode.id, scopeNode);
  }

  scopeNodeIds.add(scopeNode.id);
  return scopeNode;
}

function projectRuntimeLockEdges(options: {
  claims: RuntimeClaimRecord[];
  scopeLocks: RuntimeScopeLockRecord[];
  nodes: WorkGraphNode[];
  edges: WorkGraphEdge[];
  nodesById: Map<string, WorkGraphNode>;
  scopeNodeIds: Set<string>;
}): void {
  const claimsByToken = new Map(
    options.claims.map((claim) => [claim.claim_token, claim] as const),
  );

  for (const scopeLock of options.scopeLocks) {
    if (scopeLock.lifecycle_state !== "active") {
      continue;
    }

    const claimNodeId = `claim:${scopeLock.claim_token}`;
    const claimNode = options.nodesById.get(claimNodeId);
    const claim = claimsByToken.get(scopeLock.claim_token);
    if (!claimNode || !claim) {
      continue;
    }

    const scopeNode = ensureRuntimeLockScopeNode(
      scopeLock.scope_ref,
      options.nodes,
      options.nodesById,
      options.scopeNodeIds,
    );

    options.edges.push(
      createEdge(
        claimNode,
        scopeNode,
        "locks",
        "formal",
        {
          kind: "runtime",
          claimToken: scopeLock.claim_token,
        },
        {
          ...createRuntimeLockEdgeProperties(scopeLock, claim, scopeNode.id),
        },
      ),
    );
  }
}

function projectRelationshipEdges(options: {
  document: MarkdownDocument;
  sourceNode: WorkGraphNode;
  documents: MarkdownDocument[];
  aliases: Map<string, ResolvedDocument>;
  nodesById: Map<string, WorkGraphNode>;
  edges: WorkGraphEdge[];
  scopeNodeIds: Set<string>;
  nodes: WorkGraphNode[];
}): void {
  const links = getFrontmatterLinks(options.document.frontmatter);
  const frontmatterDependsOn = asLinkArray(links.depends_on);
  for (const target of frontmatterDependsOn) {
    const resolved = resolveDocument(target, options.documents, options.aliases);
    if (!resolved) {
      continue;
    }
    const targetNode = createResolvedTargetNode(resolved, options.nodesById);
    if (!targetNode) {
      continue;
    }
    ensureScopeNode(
      targetNode,
      options.nodes,
      options.nodesById,
      options.scopeNodeIds,
    );
    options.edges.push(
      createEdge(
        options.sourceNode,
        targetNode,
        "depends_on",
        "formal",
        {
          kind: "frontmatter",
          filePath: options.document.relativePath,
        },
        {
          sourceKey: "depends_on",
          rawTarget: target,
          resolvedTargetId: targetNode.id,
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

    const targetNode = createResolvedTargetNode(resolved, options.nodesById);
    if (!targetNode) {
      continue;
    }
    ensureScopeNode(
      targetNode,
      options.nodes,
      options.nodesById,
      options.scopeNodeIds,
    );
    options.edges.push(
      createEdge(
        options.sourceNode,
        targetNode,
        mappedType,
        "formal",
        {
          kind: "relationships",
          filePath: options.document.relativePath,
        },
        {
          sourceKey: relationship.sourceKey,
          rawTarget: relationship.target,
          resolvedTargetId: targetNode.id,
          relationship: relationship.sourceKey,
        },
      ),
    );
  }
}

function projectInformationalFrontmatterLinkEdges(options: {
  document: MarkdownDocument;
  sourceNode: WorkGraphNode;
  documents: MarkdownDocument[];
  aliases: Map<string, ResolvedDocument>;
  nodesById: Map<string, WorkGraphNode>;
  edges: WorkGraphEdge[];
  scopeNodeIds: Set<string>;
  nodes: WorkGraphNode[];
}): void {
  const links = getFrontmatterLinks(options.document.frontmatter);

  for (const [sourceKey, rawValue] of Object.entries(links)) {
    if (FORMAL_FRONTMATTER_LINK_KEYS.has(sourceKey)) {
      continue;
    }

    for (const rawTarget of asLinkArray(rawValue)) {
      const resolved = resolveDocument(
        rawTarget,
        options.documents,
        options.aliases,
      );
      if (!resolved) {
        continue;
      }

      const targetNode = createResolvedTargetNode(resolved, options.nodesById);
      if (!targetNode) {
        continue;
      }

      ensureScopeNode(
        targetNode,
        options.nodes,
        options.nodesById,
        options.scopeNodeIds,
      );
      options.edges.push(
        createEdge(
          options.sourceNode,
          targetNode,
          "references",
          "informational",
          {
            kind: "frontmatter",
            filePath: options.document.relativePath,
          },
          {
            sourceKey,
            rawTarget,
            resolvedTargetId: targetNode.id,
            frontmatterId: asString(options.document.frontmatter.id),
          },
        ),
      );
    }
  }
}

function projectWorkItemEvidenceEdges(options: {
  document: MarkdownDocument;
  sourceNode: WorkGraphNode;
  documents: MarkdownDocument[];
  aliases: Map<string, ResolvedDocument>;
  nodesById: Map<string, WorkGraphNode>;
  edges: WorkGraphEdge[];
}): void {
  const links = getFrontmatterLinks(options.document.frontmatter);
  const evidenceRefs = asLinkArray(links.evidence);

  for (const evidenceRef of evidenceRefs) {
    const resolved = resolveDocument(
      evidenceRef,
      options.documents,
      options.aliases,
    );
    if (!resolved || resolved.nodeType !== "record") {
      continue;
    }

    const recordNode = options.nodesById.get(resolved.nodeId);
    if (!recordNode) {
      continue;
    }

    options.edges.push(
      createEdge(
        recordNode,
        options.sourceNode,
        "records",
        "formal",
        {
          kind: "frontmatter",
          filePath: options.document.relativePath,
        },
        {
          sourceKey: "evidence",
          rawTarget: evidenceRef,
          resolvedTargetId: recordNode.id,
          subject: evidenceRef,
          recordKind: getRecordKind(recordNode),
          frontmatterId: asString(options.document.frontmatter.id),
        },
      ),
    );
  }
}

function resolveRecordSubjectTarget(options: {
  subject: string;
  documents: MarkdownDocument[];
  aliases: Map<string, ResolvedDocument>;
  nodesById: Map<string, WorkGraphNode>;
}): WorkGraphNode | undefined {
  const trimmedSubject = options.subject.trim();
  if (trimmedSubject.length === 0) {
    return undefined;
  }

  if (trimmedSubject.startsWith("claim:")) {
    return options.nodesById.get(trimmedSubject);
  }

  const resolved = resolveDocument(
    trimmedSubject,
    options.documents,
    options.aliases,
  );
  if (resolved) {
    return createResolvedTargetNode(resolved, options.nodesById);
  }

  try {
    return createScopeNode({
      id: canonicalScopeNodeId(trimmedSubject),
      label: trimmedSubject,
      properties: {
        scopeRef: trimmedSubject,
      },
    });
  } catch {
    return undefined;
  }
}

function projectRecordEdges(options: {
  document: MarkdownDocument;
  sourceNode: WorkGraphNode;
  documents: MarkdownDocument[];
  aliases: Map<string, ResolvedDocument>;
  nodesById: Map<string, WorkGraphNode>;
  edges: WorkGraphEdge[];
  scopeNodeIds: Set<string>;
  nodes: WorkGraphNode[];
}): void {
  const subjects = parseSectionBulletValues(
    options.document.body,
    "Subject References",
  );
  const recordKind =
    asString(options.document.frontmatter.subtype) ?? "record";

  for (const subject of subjects) {
    const targetNode = resolveRecordSubjectTarget({
      subject,
      documents: options.documents,
      aliases: options.aliases,
      nodesById: options.nodesById,
    });
    if (!targetNode) {
      continue;
    }

    ensureScopeNode(
      targetNode,
      options.nodes,
      options.nodesById,
      options.scopeNodeIds,
    );
    options.edges.push(
      createEdge(
        options.sourceNode,
        targetNode,
        "records",
        "formal",
        {
          kind: "relationships",
          filePath: options.document.relativePath,
        },
        {
          sourceKey: "subject_reference",
          rawTarget: subject,
          resolvedTargetId: targetNode.id,
          subject,
          recordKind,
          frontmatterId: asString(options.document.frontmatter.id),
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
  const classifiedDocuments = documents.map((document) => classifyDocument(document));
  const nodes: WorkGraphNode[] = [];
  const edges: WorkGraphEdge[] = [];
  const nodesById = new Map<string, WorkGraphNode>();
  const aliases = new Map<string, ResolvedDocument>();
  const scopeNodeIds = new Set<string>();
  const diagnostics = classifiedDocuments.flatMap((document) =>
    document.diagnostic ? [document.diagnostic] : [],
  );

  for (const classifiedDocument of classifiedDocuments) {
    if (!isProjectableDocument(classifiedDocument)) {
      continue;
    }
    const { document, documentId, resolved } = classifiedDocument;

    for (const alias of documentAliases(document.frontmatter, document.relativePath)) {
      aliases.set(alias, {
        document,
        nodeId: resolved.nodeId,
        nodeType: resolved.nodeType,
      });
    }

    const node = createNodeFromDocument(document, resolved.nodeType);

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
            frontmatterId: documentId,
          },
        });
        nodes.push(scopeNode);
        nodesById.set(scopeNode.id, scopeNode);
        scopeNodeIds.add(scopeId);
      }
    }
  }

  const runtimeState = options.runtimeState ?? readRuntimeProjectionState(rootDir);
  for (const claim of runtimeState.claims) {
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
        "formal",
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
  projectRuntimeLockEdges({
    claims: runtimeState.claims,
    scopeLocks: runtimeState.scopeLocks,
    nodes,
    edges,
    nodesById,
    scopeNodeIds,
  });

  for (const classifiedDocument of classifiedDocuments) {
    if (!isProjectableDocument(classifiedDocument)) {
      continue;
    }
    const { document, resolved } = classifiedDocument;
    const sourceNode = nodesById.get(resolved.nodeId);
    if (!sourceNode) {
      continue;
    }
    projectInformationalFrontmatterLinkEdges({
      document,
      sourceNode,
      documents,
      aliases,
      nodesById,
      edges,
      scopeNodeIds,
      nodes,
    });
    if (sourceNode.type === "work-item") {
      projectWorkItemEvidenceEdges({
        document,
        sourceNode,
        documents,
        aliases,
        nodesById,
        edges,
      });
      projectRelationshipEdges({
        document,
        sourceNode,
        documents,
        aliases,
        nodesById,
        edges,
        scopeNodeIds,
        nodes,
      });
      continue;
    }
    if (sourceNode.type === "record") {
      projectRecordEdges({
        document,
        sourceNode,
        documents,
        aliases,
        nodesById,
        edges,
        scopeNodeIds,
        nodes,
      });
    }
  }

  return createProjectionView(buildGraphIndex(nodes, edges), diagnostics);
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
