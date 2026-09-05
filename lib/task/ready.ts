import matter from "gray-matter";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  evaluateWorkItemGovernance,
  type WorkItemGovernanceDependency,
  type WorkItemGovernanceReason,
  type WorkItemGovernanceVerdict,
} from "../work-management/kernel.js";
import {
  readRuntimeClaimTaskSnapshots,
  type RuntimeClaimTaskSnapshot,
} from "../runtime-claim/index.js";
import {
  composeTaskRuntimeReadiness,
  loadTaskExecutionLogSummaries,
  type TaskRuntimeExecutionLog,
  type TaskRuntimeReadiness,
} from "./runtime.js";
import {
  collectTaskRecoveryGitState,
  isRecoverableReadyRuntimeState,
} from "./recovery-state.js";
import {
  evaluateTaskClaimability,
  type TaskClaimabilityFailure,
} from "./claimability.js";
import {
  readTaskAuthorityGitContext,
  resolveTaskAuthorityFromGitContext,
  type TaskAuthorityGitContext,
  type TaskAuthorityTrace,
  type TaskAuthorityUnavailable,
} from "./authority.js";
import {
  projectWorkGraph,
  type WorkGraphEdge,
  type WorkGraphNode,
  type WorkGraphProjection,
} from "../work/format-adapter.js";

type Frontmatter = Record<string, unknown>;

export type ReadyExclusionCode =
  | "archived"
  | "blocked"
  | "closed"
  | "execution_not_ready"
  | "dependency_blocked"
  | "dependency_state_unknown"
  | "hitl"
  | "invalid"
  | "missing_classification"
  | "not_active"
  | "not_ready"
  | "task_claim_active"
  | "task_claim_expired"
  | "validation_state_unknown";

export interface ReadyTaskDependency {
  id: string;
  ref: string;
  status?: string;
  lifecycle?: string;
  filePath?: string;
  satisfied: boolean;
  stateKnown: boolean;
}

export interface ReadyTaskCandidate {
  id: string;
  numericId?: string;
  title: string;
  summary?: string;
  filePath: string;
  status: string;
  lifecycle: string;
  type: string;
  subtype?: string;
  priority?: string;
  tags: string[];
  dependencies: ReadyTaskDependency[];
  runtime?: TaskRuntimeReadiness;
  findings: DerivedReadinessFinding[];
}

export interface ReadyTaskExclusion {
  id?: string;
  filePath: string;
  title?: string;
  runtime?: TaskRuntimeReadiness;
  findings: DerivedReadinessFinding[];
  reasons: Array<{
    code: ReadyExclusionCode;
    message: string;
    details?: Record<string, unknown>;
  }>;
}

export type DerivedReadinessFindingReasonCode =
  | "dependency_state_unknown"
  | "dependency_unsatisfied"
  | "governance_archived"
  | "governance_blocked"
  | "governance_closed"
  | "governance_hitl"
  | "governance_invalid"
  | "governance_missing_classification"
  | "governance_missing_completed_date"
  | "governance_missing_evidence"
  | "governance_missing_status_reason"
  | "governance_not_active"
  | "governance_not_ready"
  | "runtime_claim_active"
  | "runtime_claim_expired"
  | "runtime_execution_not_ready";

export interface DerivedReadinessFindingEvidence {
  kind: "work-item" | "claim" | "scope-lock" | "execution-log" | "governance";
  ref: string;
  details?: Record<string, unknown>;
}

export interface DerivedReadinessFinding {
  reasonCode: DerivedReadinessFindingReasonCode;
  subjectId: string;
  severity: "error" | "warn" | "info";
  message: string;
  evidence: DerivedReadinessFindingEvidence[];
}

export interface ReadyTaskSelection {
  schemaVersion: "task-ready/v1";
  candidates: ReadyTaskCandidate[];
  exclusions: ReadyTaskExclusion[];
}

interface ReadyDocument {
  filePath: string;
  relativePath: string;
  archived: boolean;
  body?: string;
  frontmatter?: Frontmatter;
  parseError?: string;
}

interface ReadyAuthorityContext {
  git: TaskAuthorityGitContext;
  trace?: TaskAuthorityTrace;
  documentsByRoot: Map<string, Promise<ReadyDocument[]>>;
  runtimeByRootAndTask: Map<string, Promise<Map<string, TaskRuntimeExecutionLog>>>;
  runtimeClaimSnapshotsByRoot: Map<string, Promise<Map<string, TaskRuntimeClaimSnapshot>>>;
}

export interface SelectReadyTasksOptions {
  rootDir?: string;
  backlogDir?: string;
  claimStorePath?: string;
  now?: Date;
  /** Test-only instrumentation for the ready-selection Git-context seam. */
  authorityTrace?: TaskAuthorityTrace;
}

const NON_TASK_PATH_PREFIXES = ["audit/", "records/"] as const;

type TaskRuntimeClaimSnapshot = RuntimeClaimTaskSnapshot;

interface ReadyGraphContext {
  dependenciesByTaskId: Map<string, ReadyTaskDependency[]>;
}

type RuntimeWorktreeUnavailable =
  | TaskAuthorityUnavailable["unavailable"]
  | {
      code: "runtime-worktree-document-missing";
      runtimeWorktree: string;
    };

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadTaskRuntimeClaimSnapshots(options: {
  rootDir: string;
  taskIds: Iterable<string>;
}): Promise<Map<string, TaskRuntimeClaimSnapshot>> {
  return readRuntimeClaimTaskSnapshots(options);
}

async function findMarkdownFiles(dirPath: string): Promise<string[]> {
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
      files.push(...(await findMarkdownFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

async function readReadyDocuments(
  rootDir: string,
  backlogDir: string,
): Promise<ReadyDocument[]> {
  const backlogRoot = path.resolve(rootDir, backlogDir);
  const files = await findMarkdownFiles(backlogRoot);
  const documents: ReadyDocument[] = [];
  for (const filePath of files) {
    const relativeToBacklog = toPosixPath(path.relative(backlogRoot, filePath));
    if (NON_TASK_PATH_PREFIXES.some((prefix) => relativeToBacklog.startsWith(prefix))) {
      continue;
    }
    const relativePath = toPosixPath(path.relative(rootDir, filePath));
    try {
      const parsed = matter(await fs.readFile(filePath, "utf8"));
      documents.push({
        filePath,
        relativePath,
        archived: relativeToBacklog.startsWith("archive/"),
        body: parsed.content,
        frontmatter: (parsed.data ?? {}) as Frontmatter,
      });
    } catch (error) {
      documents.push({
        filePath,
        relativePath,
        archived: relativeToBacklog.startsWith("archive/"),
        parseError: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return documents;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }
  return [
    ...new Set(
      tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
}

function collectStringLinks(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getLinks(frontmatter: Frontmatter): Record<string, unknown> {
  return typeof frontmatter.links === "object" && frontmatter.links !== null
    ? (frontmatter.links as Record<string, unknown>)
    : {};
}

function stripWikiLink(value: string): string {
  const trimmed = value.trim();
  const withoutBrackets = trimmed.replace(/^\[\[/u, "").replace(/\]\]$/u, "");
  return withoutBrackets.split("|", 1)[0]?.split("#", 1)[0]?.trim() ?? "";
}

function normalizeDependencyId(ref: string): string {
  const stripped = stripWikiLink(ref);
  const match = stripped.match(/^(?:wi-)?(\d+)/);
  return match ? `wi-${match[1]}` : stripped;
}

function stripMarkdownExtension(value: string): string {
  return value.replace(/\.md$/iu, "");
}

function normalizeReferenceToken(value: string): string {
  return value.trim().toLowerCase();
}

function addReferenceToken(tokens: Set<string>, value: string): void {
  tokens.add(normalizeReferenceToken(value));
}

function addPathReferenceTokens(tokens: Set<string>, filePath: string): void {
  addReferenceToken(tokens, filePath);
  const basename = path.posix.basename(filePath);
  addReferenceToken(tokens, basename);
  addReferenceToken(tokens, stripMarkdownExtension(basename));
}

function resolveReferencePath(
  taskRelativePath: string,
  referencePath: string,
): string | undefined {
  if (!referencePath.includes("/")) {
    return undefined;
  }

  if (referencePath.startsWith("/")) {
    return referencePath.replace(/^\/+/u, "");
  }

  return path.posix.normalize(
    path.posix.join(path.posix.dirname(taskRelativePath), referencePath),
  );
}

function dependencySatisfied(
  status: string | undefined,
  lifecycle: string | undefined,
): boolean {
  return (
    status === "completed" ||
    status === "closed" ||
    lifecycle === "inactive"
  );
}

function documentTaskId(document: ReadyDocument): string | undefined {
  return document.frontmatter ? asString(document.frontmatter.id) : undefined;
}

function documentReferenceAliases(document: ReadyDocument): string[] {
  const basename = path.basename(document.filePath, ".md");
  const id = documentTaskId(document);
  const numericPrefix = basename.match(/^(\d+)/)?.[1];
  return [
    ...(id ? [id, id.replace(/^wi-/, "")] : []),
    basename,
    ...(numericPrefix ? [numericPrefix] : []),
  ];
}

function findDependencyDocument(
  ref: string,
  documents: ReadyDocument[],
): ReadyDocument | undefined {
  const stripped = stripWikiLink(ref);
  const normalizedId = normalizeDependencyId(ref);
  const numeric = normalizedId.replace(/^wi-/, "");
  return documents.find((document) => {
    const keys = documentReferenceAliases(document);
    return (
      keys.includes(stripped) ||
      keys.includes(normalizedId) ||
      keys.includes(numeric)
    );
  });
}

function toDependency(
  ref: string,
  documents: ReadyDocument[],
): ReadyTaskDependency {
  const dependency = findDependencyDocument(ref, documents);
  const id = normalizeDependencyId(ref);
  const status = dependency?.frontmatter
    ? asString(dependency.frontmatter.status)
    : undefined;
  const lifecycle = dependency?.frontmatter
    ? asString(dependency.frontmatter.lifecycle)
    : undefined;
  return {
    id,
    ref,
    ...(status ? { status } : {}),
    ...(lifecycle ? { lifecycle } : {}),
    ...(dependency ? { filePath: dependency.relativePath } : {}),
    satisfied: dependencySatisfied(status, lifecycle),
    stateKnown: Boolean(dependency && !dependency.parseError && status),
  };
}

function toGovernanceDependencyRecord(
  dependency: ReadyTaskDependency,
): WorkItemGovernanceDependency {
  return {
    id: dependency.id,
    ref: dependency.ref,
    ...(dependency.status ? { status: dependency.status } : {}),
    ...(dependency.lifecycle ? { lifecycle: dependency.lifecycle } : {}),
    ...(dependency.filePath ? { filePath: dependency.filePath } : {}),
    satisfied: dependency.satisfied,
    stateKnown: dependency.stateKnown,
  };
}

function normalizeBacklogDir(backlogDir: string): string {
  return toPosixPath(backlogDir).replace(/\/+$/u, "");
}

function isProjectedBacklogWorkItem(
  node: WorkGraphNode,
  backlogDir: string,
): boolean {
  const filePath = node.source.filePath;
  if (node.type !== "work-item" || !filePath) {
    return false;
  }

  const backlogRoot = `${backlogDir}/`;
  if (!filePath.startsWith(backlogRoot)) {
    return false;
  }

  return !(
    filePath.startsWith(`${backlogDir}/archive/`) ||
    filePath.startsWith(`${backlogDir}/audit/`) ||
    filePath.startsWith(`${backlogDir}/records/`)
  );
}

function normalizedDocumentReferenceAliases(document: ReadyDocument): string[] {
  return documentReferenceAliases(document).map((entry) =>
    normalizeReferenceToken(entry),
  );
}

function referenceTokens(taskRelativePath: string, ref: string): Set<string> {
  const stripped = stripWikiLink(ref);
  const normalizedId = normalizeDependencyId(ref);
  const tokens = new Set<string>();

  addPathReferenceTokens(tokens, stripped);
  addReferenceToken(tokens, normalizedId);
  addReferenceToken(tokens, normalizedId.replace(/^wi-/u, ""));

  const resolvedPath = resolveReferencePath(taskRelativePath, stripped);
  if (resolvedPath) {
    addPathReferenceTokens(tokens, resolvedPath);
  }

  return tokens;
}

function dependencyReferenceTokens(
  dependency: ReadyTaskDependency,
  dependencyDocument: ReadyDocument | undefined,
): Set<string> {
  const tokens = new Set<string>();

  addReferenceToken(tokens, dependency.id);
  addReferenceToken(tokens, dependency.id.replace(/^wi-/u, ""));

  if (dependency.filePath) {
    addPathReferenceTokens(tokens, dependency.filePath);
  }

  if (dependencyDocument) {
    for (const alias of normalizedDocumentReferenceAliases(dependencyDocument)) {
      tokens.add(alias);
    }
    addReferenceToken(tokens, dependencyDocument.relativePath);
  }

  return tokens;
}

function setsIntersect(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  for (const value of right) {
    if (left.has(value)) {
      return true;
    }
  }
  return false;
}

function projectedNodeDependencyId(node: WorkGraphNode): string {
  return typeof node.properties.frontmatterId === "string"
    ? node.properties.frontmatterId
    : node.id.replace(/^wi:/, "wi-");
}

function projectedNodeDependencyState(
  node: WorkGraphNode,
  dependencyDocument: ReadyDocument | undefined,
): { status?: string; lifecycle?: string } {
  const status = dependencyDocument?.frontmatter
    ? asString(dependencyDocument.frontmatter.status)
    : asString(node.properties.status);
  const lifecycle = dependencyDocument?.frontmatter
    ? asString(dependencyDocument.frontmatter.lifecycle)
    : asString(node.properties.lifecycle);
  return { ...(status ? { status } : {}), ...(lifecycle ? { lifecycle } : {}) };
}

function buildGraphReadyDependencies(options: {
  document: ReadyDocument;
  documentsById: Map<string, ReadyDocument>;
  nodeByFrontmatterId: Map<string, WorkGraphNode>;
  projection: WorkGraphProjection;
}): ReadyTaskDependency[] {
  const id = documentTaskId(options.document);
  if (!id) {
    return [];
  }

  const sourceNode = options.nodeByFrontmatterId.get(id);
  if (!sourceNode) {
    return [];
  }

  const knownDependencies = options.projection
    .getOutgoingEdges(sourceNode.id)
    .filter(
      (edge): edge is WorkGraphEdge =>
        edge.authority === "formal" && edge.type === "depends_on",
    )
    .map((edge) => options.projection.findNode(edge.to))
    .filter((node): node is WorkGraphNode => Boolean(node && node.type === "work-item"))
    .map((node) => {
      const dependencyId = projectedNodeDependencyId(node);
      const dependencyDocument = options.documentsById.get(dependencyId);
      const { status, lifecycle } = projectedNodeDependencyState(
        node,
        dependencyDocument,
      );
      return {
        id: dependencyId,
        ref: `[[${dependencyId}]]`,
        ...(status ? { status } : {}),
        ...(lifecycle ? { lifecycle } : {}),
        ...(dependencyDocument ? { filePath: dependencyDocument.relativePath } : {}),
        satisfied: dependencySatisfied(status, lifecycle),
        stateKnown: Boolean(status),
      } satisfies ReadyTaskDependency;
    });
  const knownDependencyEntries = knownDependencies.map((dependency) => ({
    dependency,
    tokens: dependencyReferenceTokens(
      dependency,
      options.documentsById.get(dependency.id),
    ),
  }));

  const authoredRefs = [
    ...new Set(collectStringLinks(getLinks(options.document.frontmatter ?? {}).depends_on)),
  ];
  if (authoredRefs.length === 0) {
    return knownDependencies;
  }

  const orderedDependencies: ReadyTaskDependency[] = [];
  const matchedDependencyIds = new Set<string>();
  for (const ref of authoredRefs) {
    const refTokens = referenceTokens(options.document.relativePath, ref);
    let matchedDependency: ReadyTaskDependency | undefined;
    let matchesKnownDependency = false;

    for (const entry of knownDependencyEntries) {
      if (!setsIntersect(entry.tokens, refTokens)) {
        continue;
      }

      matchesKnownDependency = true;
      if (!matchedDependencyIds.has(entry.dependency.id)) {
        matchedDependency = entry.dependency;
        break;
      }
    }

    if (matchedDependency) {
      matchedDependencyIds.add(matchedDependency.id);
      orderedDependencies.push({
        ...matchedDependency,
        ref,
      });
      continue;
    }

    if (matchesKnownDependency) {
      continue;
    }

    orderedDependencies.push({
      id: normalizeDependencyId(ref),
      ref,
      satisfied: false,
      stateKnown: false,
    });
  }

  for (const dependency of knownDependencies) {
    if (!matchedDependencyIds.has(dependency.id)) {
      orderedDependencies.push(dependency);
    }
  }

  return orderedDependencies;
}

async function buildReadyGraphContext(options: {
  rootDir: string;
  backlogDir: string;
  documents: ReadyDocument[];
}): Promise<ReadyGraphContext> {
  const backlogDir = normalizeBacklogDir(options.backlogDir);
  const projection = await projectWorkGraph({
    rootDir: options.rootDir,
    workspaceDirs: [...new Set([backlogDir, "docs"])],
  });
  const documentsById = new Map(
    options.documents
      .map((document) => [documentTaskId(document), document] as const)
      .filter((entry): entry is readonly [string, ReadyDocument] => Boolean(entry[0])),
  );
  const nodeByFrontmatterId = new Map(
    projection
      .getNodesByType("work-item")
      .filter((node) => isProjectedBacklogWorkItem(node, backlogDir))
      .map((node) => [
        typeof node.properties.frontmatterId === "string"
          ? node.properties.frontmatterId
          : undefined,
        node,
      ] as const)
      .filter((entry): entry is readonly [string, WorkGraphNode] => Boolean(entry[0])),
  );
  const dependenciesByTaskId = new Map<string, ReadyTaskDependency[]>();
  for (const [taskId] of nodeByFrontmatterId) {
    const document = documentsById.get(taskId);
    if (!document) {
      continue;
    }
    dependenciesByTaskId.set(
      taskId,
      buildGraphReadyDependencies({
        document,
        documentsById,
        nodeByFrontmatterId,
        projection,
      }),
    );
  }

  return {
    dependenciesByTaskId,
  };
}

function reason(
  code: ReadyExclusionCode,
  message: string,
  details?: Record<string, unknown>,
): ReadyTaskExclusion["reasons"][number] {
  return { code, message, ...(details ? { details } : {}) };
}

function toReadyReason(
  entry: WorkItemGovernanceReason,
): ReadyTaskExclusion["reasons"][number] {
  switch (entry.code) {
    case "archived":
    case "blocked":
    case "closed":
    case "dependency_blocked":
    case "dependency_state_unknown":
    case "hitl":
    case "invalid":
    case "missing_classification":
    case "not_active":
    case "not_ready":
      return reason(entry.code, entry.message, entry.details);
    default:
      throw new Error(`Unsupported governance reason: ${entry.code}`);
  }
}

function toGovernanceFindingReasonCode(
  code: WorkItemGovernanceReason["code"],
): DerivedReadinessFindingReasonCode | undefined {
  switch (code) {
    case "archived":
      return "governance_archived";
    case "blocked":
      return "governance_blocked";
    case "closed":
      return "governance_closed";
    case "dependency_blocked":
      return "dependency_unsatisfied";
    case "dependency_state_unknown":
      return "dependency_state_unknown";
    case "hitl":
      return "governance_hitl";
    case "invalid":
      return "governance_invalid";
    case "missing_classification":
      return "governance_missing_classification";
    case "missing_completed_date":
      return "governance_missing_completed_date";
    case "missing_evidence":
      return "governance_missing_evidence";
    case "missing_status_reason":
      return "governance_missing_status_reason";
    case "not_active":
      return "governance_not_active";
    case "not_ready":
      return "governance_not_ready";
  }
}

function governanceReasonEvidence(
  entry: WorkItemGovernanceReason,
): DerivedReadinessFindingEvidence[] {
  if (
    (entry.code === "dependency_blocked" ||
      entry.code === "dependency_state_unknown") &&
    Array.isArray(entry.details?.dependencies)
  ) {
    return entry.details.dependencies
      .filter(
        (dependency): dependency is WorkItemGovernanceDependency =>
          typeof dependency === "object" && dependency !== null,
      )
      .map((dependency) => ({
        kind: "work-item" as const,
        ref: dependency.id,
        details: {
          ref: dependency.ref,
          satisfied: dependency.satisfied,
          stateKnown: dependency.stateKnown,
          ...(dependency.status ? { status: dependency.status } : {}),
          ...(dependency.lifecycle ? { lifecycle: dependency.lifecycle } : {}),
          ...(dependency.filePath ? { filePath: dependency.filePath } : {}),
        },
      }));
  }

  return [
    {
      kind: "governance",
      ref: entry.code,
      ...(entry.details ? { details: entry.details } : {}),
    },
  ];
}

function projectDerivedReadinessFindings(options: {
  subjectId: string;
  governance: WorkItemGovernanceVerdict;
  runtime?: TaskRuntimeReadiness;
  runtimeClaim?: TaskRuntimeClaimSnapshot;
}): DerivedReadinessFinding[] {
  const findings: DerivedReadinessFinding[] = [];
  const seen = new Set<string>();

  const pushFinding = (finding: DerivedReadinessFinding) => {
    const key = JSON.stringify([
      finding.reasonCode,
      finding.subjectId,
      finding.message,
      finding.evidence.map((entry) => [entry.kind, entry.ref]),
    ]);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    findings.push(finding);
  };

  const governanceReasons = [
    ...options.governance.readiness.reasons,
    ...options.governance.evidence.reasons,
  ];
  for (const reason of governanceReasons) {
    const reasonCode = toGovernanceFindingReasonCode(reason.code);
    if (!reasonCode) {
      continue;
    }
    pushFinding({
      reasonCode,
      subjectId: options.subjectId,
      severity: reason.code === "dependency_state_unknown" ? "warn" : "error",
      message: reason.message,
      evidence: governanceReasonEvidence(reason),
    });
  }

  if (options.runtimeClaim?.claim.state === "active") {
    pushFinding({
      reasonCode: "runtime_claim_active",
      subjectId: options.subjectId,
      severity: "error",
      message: "Task has an active runtime claim.",
      evidence: [
        {
          kind: "claim",
          ref: `claim:${options.subjectId}`,
          details: {
            claimToken: options.runtimeClaim.claim.token,
            holder: options.runtimeClaim.claim.holder,
            expiresAt: options.runtimeClaim.claim.expiresAt,
            lockCount: options.runtimeClaim.activeScopeLocks.length,
          },
        },
        ...options.runtimeClaim.activeScopeLocks.map((lock) => ({
          kind: "scope-lock" as const,
          ref: lock.scopeRef,
          details: {
            claimToken: lock.claimToken,
            lockMode: lock.lockMode,
            lifecycleState: lock.lifecycleState,
            policyName: lock.policyName,
          },
        })),
      ],
    });
  }

  if (options.runtimeClaim?.claim.state === "expired") {
    pushFinding({
      reasonCode: "runtime_claim_expired",
      subjectId: options.subjectId,
      severity: "error",
      message: "Task has an expired runtime claim that still requires recovery.",
      evidence: [
        {
          kind: "claim",
          ref: `claim:${options.subjectId}`,
          details: {
            claimToken: options.runtimeClaim.claim.token,
            holder: options.runtimeClaim.claim.holder,
            expiresAt: options.runtimeClaim.claim.expiresAt,
          },
        },
      ],
    });
  }

  if (options.runtime?.latestExecutionLog && options.runtime.executionReady !== true) {
    pushFinding({
      reasonCode: "runtime_execution_not_ready",
      subjectId: options.subjectId,
      severity: "error",
      message: "Task's latest execution log entry is not ready-permitting.",
      evidence: [
        {
          kind: "execution-log",
          ref: options.runtime.latestExecutionLog.claimToken,
          details: {
            state: options.runtime.latestExecutionLog.state,
            reason: options.runtime.latestExecutionLog.reason,
            createdAt: options.runtime.latestExecutionLog.createdAt,
            readyPermitting: options.runtime.latestExecutionLog.readyPermitting,
            ...(options.runtime.latestExecutionLog.claimState
              ? { claimState: options.runtime.latestExecutionLog.claimState }
              : {}),
            ...(options.runtime.latestExecutionLog.lockCount !== undefined
              ? { lockCount: options.runtime.latestExecutionLog.lockCount }
              : {}),
          },
        },
      ],
    });
  }

  return findings;
}

function hasReason(
  reasons: ReadyTaskExclusion["reasons"],
  codes: ReadyExclusionCode[],
): boolean {
  return reasons.some((entry) => codes.includes(entry.code));
}

function claimabilityFailureReason(
  failure: TaskClaimabilityFailure,
): ReadyTaskExclusion["reasons"][number] | undefined {
  switch (failure) {
    case "not-active":
      return reason("not_active", "Task lifecycle is not active.");
    case "not-ready":
      return reason("not_ready", "Task status is not ready.");
    case "not-afk":
      return reason("missing_classification", "Task is missing AFK classification.");
    case "hitl":
      return reason("hitl", "HITL tasks are not AFK-ready candidates.");
    case "dependencies-not-satisfied":
      return reason("dependency_blocked", "Task has unsatisfied dependencies.");
    case "execution-not-ready":
      return undefined;
  }
}

function appendClaimabilityGovernanceReasons(
  reasons: ReadyTaskExclusion["reasons"],
  failures: TaskClaimabilityFailure[],
): void {
  for (const failure of failures) {
    if (
      failure === "not-active" &&
      hasReason(reasons, ["not_active", "closed", "archived"])
    ) {
      continue;
    }
    if (failure === "not-ready" && hasReason(reasons, ["not_ready"])) {
      continue;
    }
    if (
      failure === "not-afk" &&
      hasReason(reasons, ["missing_classification", "hitl"])
    ) {
      continue;
    }
    if (failure === "hitl" && hasReason(reasons, ["hitl"])) {
      continue;
    }
    if (
      failure === "dependencies-not-satisfied" &&
      hasReason(reasons, ["dependency_blocked", "dependency_state_unknown"])
    ) {
      continue;
    }

    const readyReason = claimabilityFailureReason(failure);
    if (readyReason) {
      reasons.push(readyReason);
    }
  }
}

function toCandidate(
  document: ReadyDocument,
  dependencies: ReadyTaskDependency[],
  findings: DerivedReadinessFinding[],
): ReadyTaskCandidate {
  const frontmatter = document.frontmatter as Frontmatter;
  const id = asString(frontmatter.id) ?? "";
  const summary = asString(frontmatter.summary);
  const subtype = asString(frontmatter.subtype);
  const priority = asString(frontmatter.priority);
  const numericId = id.match(/^wi-(\d+)/)?.[1];
  return {
    id,
    ...(numericId ? { numericId } : {}),
    title: asString(frontmatter.title) ?? id,
    ...(summary ? { summary } : {}),
    filePath: document.relativePath,
    status: asString(frontmatter.status) ?? "",
    lifecycle: asString(frontmatter.lifecycle) ?? "",
    type: asString(frontmatter.type) ?? "",
    ...(subtype ? { subtype } : {}),
    ...(priority ? { priority } : {}),
    tags: normalizeTags(frontmatter.tags),
    dependencies,
    findings,
  };
}

async function evaluateDocument(
  rootDir: string,
  document: ReadyDocument,
  documents: ReadyDocument[],
  latestExecutionLog?: TaskRuntimeExecutionLog,
  runtimeClaimSnapshots?: Map<string, TaskRuntimeClaimSnapshot>,
  projectedDependencies?: ReadyTaskDependency[],
  runtimeWorktreeUnavailable?: RuntimeWorktreeUnavailable,
): Promise<{ candidate?: ReadyTaskCandidate; exclusion?: ReadyTaskExclusion }> {
  if (document.parseError) {
    return {
      exclusion: {
        filePath: document.relativePath,
        findings: [],
        reasons: [
          reason("validation_state_unknown", "Task frontmatter could not be parsed.", {
            error: document.parseError,
          }),
        ],
      },
    };
  }

  const frontmatter = document.frontmatter ?? {};
  const type = asString(frontmatter.type);
  if (type !== "work-item") {
    return {};
  }

  const id = asString(frontmatter.id);
  const title = asString(frontmatter.title);
  const status = asString(frontmatter.status);
  const lifecycle = asString(frontmatter.lifecycle);
  const tags = normalizeTags(frontmatter.tags);
  const links = getLinks(frontmatter);
  const dependencies = projectedDependencies
    ?? collectStringLinks(links.depends_on).map((ref) => toDependency(ref, documents));
  const governance = evaluateWorkItemGovernance({
    id: id ?? "",
    ...(title ? { title } : {}),
    status: status ?? "",
    lifecycle: lifecycle ?? "",
    tags,
    archived: document.archived || lifecycle === "archived",
    links,
    dependencies: dependencies.map(toGovernanceDependencyRecord),
  });
  const runtimeClaim = id ? runtimeClaimSnapshots?.get(id) : undefined;
  const reasons: ReadyTaskExclusion["reasons"] = governance.readiness.reasons.map(
    toReadyReason,
  );
  const readiness = composeTaskRuntimeReadiness(
    governance.readiness.ready,
    runtimeWorktreeUnavailable && latestExecutionLog
      ? { ...latestExecutionLog, readyPermitting: false }
      : latestExecutionLog,
  );
  const findings = id
    ? projectDerivedReadinessFindings({
        subjectId: id,
        governance,
        runtime: readiness,
        runtimeClaim,
      })
    : [];
  const claimability = evaluateTaskClaimability({
    id: id ?? "",
    validation: {
      isActive: governance.lifecycle.isActive,
      isReady: status === "ready",
      isAfk: governance.classification.isAfk,
      isHitl: governance.classification.isHitl,
      dependenciesSatisfied: governance.dependencies.satisfied,
    },
    runtime: readiness,
  });

  appendClaimabilityGovernanceReasons(reasons, claimability.failures);

  if (runtimeClaim?.claim.state === "active") {
    reasons.push(
      reason("task_claim_active", "Task has an active runtime claim.", {
        claimToken: runtimeClaim.claim.token,
        holder: runtimeClaim.claim.holder,
        expiresAt: runtimeClaim.claim.expiresAt,
      }),
    );
  }

  if (runtimeClaim?.claim.state === "expired") {
    reasons.push(
      reason("task_claim_expired", "Task has an expired runtime claim.", {
        claimToken: runtimeClaim.claim.token,
        holder: runtimeClaim.claim.holder,
        expiresAt: runtimeClaim.claim.expiresAt,
      }),
    );
  }

  if (claimability.failures.includes("execution-not-ready")) {
    if (runtimeWorktreeUnavailable) {
      reasons.push(
        reason(
          "execution_not_ready",
          "Execution metadata worktree is unavailable.",
          {
            latestExecutionLog: readiness.latestExecutionLog,
            runtimeWorktree: runtimeWorktreeUnavailable,
          },
        ),
      );
    } else {
      const gitState = collectTaskRecoveryGitState({
        rootDir,
        taskFilePath: document.relativePath,
        expectedBranch: readiness.latestExecutionLog?.branch,
      });
      const recoverable = isRecoverableReadyRuntimeState({
        status: status ?? "",
        runtime: readiness,
        gitState,
      });
      const recoverableWithForce = isRecoverableReadyRuntimeState({
        status: status ?? "",
        runtime: readiness,
        gitState,
        allowUncertainLineage: true,
      });
      reasons.push(
        reason(
          "execution_not_ready",
          "Task's latest execution log entry is not ready-permitting.",
          {
            latestExecutionLog: readiness.latestExecutionLog,
            recovery: {
              recoverable,
              recoverableWithForce,
              forceRequired: !recoverable && recoverableWithForce,
              forceReasons:
                !recoverable && recoverableWithForce
                  ? [...gitState.resumeWarnings]
                  : [],
              gitState,
            },
          },
        ),
      );
    }
  }

  if (!title) {
    reasons.push(
      reason("invalid", "Task is missing required ready-selection metadata.", {
        missing: [
          ...(!title ? ["title"] : []),
        ],
      }),
    );
  }

  if (reasons.length > 0 || !claimability.claimable) {
    return {
      exclusion: {
        ...(id ? { id } : {}),
        filePath: document.relativePath,
        ...(title ? { title } : {}),
        runtime: readiness,
        findings,
        reasons,
      },
    };
  }

  return {
    candidate: {
      ...toCandidate(document, dependencies, findings),
      runtime: readiness,
    },
  };
}

async function evaluateDocumentWithAuthority(
  rootDir: string,
  backlogDir: string,
  document: ReadyDocument,
  documents: ReadyDocument[],
  latestExecutionLog?: TaskRuntimeExecutionLog,
  authorityContext?: ReadyAuthorityContext,
  projectedDependencies?: ReadyTaskDependency[],
): Promise<{ candidate?: ReadyTaskCandidate; exclusion?: ReadyTaskExclusion }> {
  const taskId = asString(document.frontmatter?.id);
  if (!taskId) {
    return evaluateDocument(rootDir, document, documents, latestExecutionLog);
  }

  const authority = authorityContext
    ? resolveTaskAuthorityFromGitContext(
        {
          rootDir,
          taskId,
          runtimeBranch: latestExecutionLog?.branch,
          runtimeWorktree: latestExecutionLog?.worktree,
          runtimeWorktreeInvalid: latestExecutionLog?.worktreeMetadataInvalid,
        },
        authorityContext.git,
        authorityContext.trace,
      )
    : {
        rootDir,
        source: "current-root" as const,
      };
  if (authority.source === "runtime-worktree-unavailable") {
    return evaluateDocument(
      rootDir,
      document,
      documents,
      latestExecutionLog,
      undefined,
      projectedDependencies,
      authority.unavailable,
    );
  }

  if (authority.rootDir === rootDir) {
    const runtimeClaimSnapshotsPromise =
      authorityContext?.runtimeClaimSnapshotsByRoot.get(authority.rootDir)
      ?? loadTaskRuntimeClaimSnapshots({
        rootDir: authority.rootDir,
        taskIds: documents
          .map((candidate) => asString(candidate.frontmatter?.id))
          .filter((id): id is string => Boolean(id)),
      });
    authorityContext?.runtimeClaimSnapshotsByRoot.set(
      authority.rootDir,
      runtimeClaimSnapshotsPromise,
    );
    return evaluateDocument(
      rootDir,
      document,
      documents,
      latestExecutionLog,
      await runtimeClaimSnapshotsPromise,
      authority.rootDir === rootDir ? projectedDependencies : undefined,
    );
  }

  const documentsPromise = authorityContext?.documentsByRoot.get(authority.rootDir)
    ?? readReadyDocuments(authority.rootDir, backlogDir);
  authorityContext?.documentsByRoot.set(authority.rootDir, documentsPromise);
  const authorityDocuments = await documentsPromise;
  const authorityDocument = authorityDocuments.find(
    (candidate) => asString(candidate.frontmatter?.id) === taskId,
  );
  if (!authorityDocument) {
    return evaluateDocument(
      rootDir,
      document,
      documents,
      latestExecutionLog,
      undefined,
      projectedDependencies,
      {
        code: "runtime-worktree-document-missing",
        runtimeWorktree: authority.rootDir,
      },
    );
  }

  const runtimeKey = `${authority.rootDir}\0${taskId}`;
  const runtimePromise = authorityContext?.runtimeByRootAndTask.get(runtimeKey)
    ?? loadTaskExecutionLogSummaries({
      rootDir: authority.rootDir,
      taskIds: [taskId],
    });
  authorityContext?.runtimeByRootAndTask.set(runtimeKey, runtimePromise);
  const authorityRuntime = await runtimePromise;
  const runtimeClaimSnapshotsPromise =
    authorityContext?.runtimeClaimSnapshotsByRoot.get(authority.rootDir)
    ?? loadTaskRuntimeClaimSnapshots({
      rootDir: authority.rootDir,
      taskIds: authorityDocuments
        .map((candidate) => asString(candidate.frontmatter?.id))
        .filter((id): id is string => Boolean(id)),
    });
  authorityContext?.runtimeClaimSnapshotsByRoot.set(
    authority.rootDir,
    runtimeClaimSnapshotsPromise,
  );
  return evaluateDocument(
    authority.rootDir,
    authorityDocument,
    authorityDocuments,
    authorityRuntime.get(taskId),
    await runtimeClaimSnapshotsPromise,
    projectedDependencies,
  );
}

function sortByFilePath<T extends { filePath: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.filePath.localeCompare(right.filePath));
}

const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function priorityRank(priority: string | undefined): number {
  return priority ? (PRIORITY_RANK[priority.toLowerCase()] ?? 4) : 4;
}

function sortReadyCandidates(items: ReadyTaskCandidate[]): ReadyTaskCandidate[] {
  return [...items].sort((left, right) => {
    const priorityDelta = priorityRank(left.priority) - priorityRank(right.priority);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return left.filePath.localeCompare(right.filePath);
  });
}

export async function selectReadyTasks(
  options: SelectReadyTasksOptions = {},
): Promise<ReadyTaskSelection> {
  const gitContext = await readTaskAuthorityGitContext(
    options.rootDir ?? process.cwd(),
    options.authorityTrace,
  );
  const rootDir = gitContext.rootDir;
  const backlogDir = options.backlogDir ?? "backlog";
  const documents = await readReadyDocuments(rootDir, backlogDir);
  const graphContext = await buildReadyGraphContext({
    rootDir,
    backlogDir,
    documents,
  });
  const taskIds = documents
    .map((document) => asString(document.frontmatter?.id))
    .filter((id): id is string => Boolean(id));
  const runtimeSummaries = await loadTaskExecutionLogSummaries({
    rootDir,
    taskIds,
  });
  const runtimeClaimSnapshots = await loadTaskRuntimeClaimSnapshots({
    rootDir,
    taskIds,
  });
  const authorityContext: ReadyAuthorityContext = {
    git: gitContext,
    ...(options.authorityTrace ? { trace: options.authorityTrace } : {}),
    documentsByRoot: new Map([[rootDir, Promise.resolve(documents)]]),
    runtimeByRootAndTask: new Map(),
    runtimeClaimSnapshotsByRoot: new Map([[rootDir, Promise.resolve(runtimeClaimSnapshots)]]),
  };
  const results = await Promise.all(
    documents.map((document) => {
      const taskId = asString(document.frontmatter?.id);
      return evaluateDocumentWithAuthority(
        rootDir,
        backlogDir,
        document,
        documents,
        taskId ? runtimeSummaries.get(taskId) : undefined,
        authorityContext,
        taskId ? graphContext.dependenciesByTaskId.get(taskId) : undefined,
      );
    }),
  );
  return {
    schemaVersion: "task-ready/v1",
    candidates: sortReadyCandidates(
      results
        .map((result) => result.candidate)
        .filter((candidate): candidate is ReadyTaskCandidate => Boolean(candidate)),
    ),
    exclusions: sortByFilePath(
      results
        .map((result) => result.exclusion)
        .filter((exclusion): exclusion is ReadyTaskExclusion => Boolean(exclusion)),
    ),
  };
}

export function formatReadyPorcelain(selection: ReadyTaskSelection): string {
  return selection.candidates
    .map((candidate) =>
      [candidate.id, candidate.filePath, candidate.title.replace(/\s+/g, " ").trim()].join(
        "\t",
      ),
    )
    .join("\n");
}

function appendSelectedSection(
  lines: string[],
  candidates: ReadyTaskCandidate[],
): void {
  lines.push("Selected");
  if (candidates.length === 0) {
    lines.push("- None");
    lines.push("");
    return;
  }

  for (const candidate of candidates) {
    lines.push(`- ${candidate.id} | ${candidate.title} | ${candidate.filePath}`);
  }
}

export function formatReadyText(selection: ReadyTaskSelection): string {
  const lines: string[] = [];
  lines.push("Ready work candidates");
  lines.push(`Candidates: ${selection.candidates.length}`);
  const recoverable = selection.exclusions.filter((exclusion) =>
    exclusion.reasons.some((entry) => {
      const recovery = entry.details?.recovery as
        | { recoverable?: boolean }
        | undefined;
      return entry.code === "execution_not_ready" && recovery?.recoverable === true;
    }),
  );
  const forceRecoverable = selection.exclusions.filter((exclusion) =>
    exclusion.reasons.some((entry) => {
      const recovery = entry.details?.recovery as
        | { forceRequired?: boolean }
        | undefined;
      return entry.code === "execution_not_ready" && recovery?.forceRequired === true;
    }),
  );
  if (recoverable.length > 0) {
    lines.push(
      `Recoverable: ${recoverable.length} (${recoverable
        .map((entry) => entry.id)
        .join(", ")})`,
    );
    lines.push("Run `dv work recover <task-id>` to make a recoverable work item claimable again.");
  }
  if (forceRecoverable.length > 0) {
    lines.push(
      `Recoverable with --force: ${forceRecoverable.length} (${forceRecoverable
        .map((entry) => entry.id)
        .join(", ")})`,
    );
    lines.push("Branch lineage or task-local dirty state is uncertain; inspect before forcing recovery.");
  }
  lines.push("");

  appendSelectedSection(lines, selection.candidates);

  return lines.join("\n");
}
