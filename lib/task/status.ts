import path from "node:path";
import { loadCanonicalTask, type CanonicalTaskBodySection } from "./canonical.js";
import type { TaskModel } from "./model.js";
import {
  collectTaskRecoveryGitState,
  isRecoverableReadyRuntimeState,
  type TaskRecoveryGitState,
} from "./recovery-state.js";
import {
  projectWorkGraph,
  type WorkGraphEdge,
  type WorkGraphProjectionDiagnostic,
} from "../work/projection.js";
import { canonicalizeWorkItemScopeRef } from "../work/scope-ref.js";

type StatusRelationshipType = "belongs_to" | "depends_on" | "implements";
type StatusDiagnosticScope = "formal" | "informational";

interface AuthoredStatusReference {
  scope: StatusDiagnosticScope;
  sourceKey: string;
  target: string;
}

export interface TaskStatusGraphRelationship {
  type: StatusRelationshipType;
  target: string;
}

export interface TaskStatusGraphInformationalReference {
  type: "references";
  sourceKey: string;
  target: string;
  resolvedTargetId: string;
}

export interface TaskStatusGraphProjectionDiagnostic {
  scope: StatusDiagnosticScope;
  sourceKey: string;
  target: string;
  classification: WorkGraphProjectionDiagnostic["classification"] | "unresolved";
  reasonCode: WorkGraphProjectionDiagnostic["reasonCode"] | "unresolved-target";
  relativePath?: string;
  documentId?: string;
}

export interface TaskStatusGraphFacts {
  relationships: TaskStatusGraphRelationship[];
  diagnostics: {
    projection: TaskStatusGraphProjectionDiagnostic[];
    informationalReferences: TaskStatusGraphInformationalReference[];
  };
}

export interface TaskStatusReport {
  schemaVersion: "task-status/v1";
  id: string;
  title: string;
  filePath: string;
  status: string;
  statusReason?: string;
  lifecycle: string;
  validation: TaskModel["validation"];
  runtime?: TaskModel["runtime"];
  recovery: {
    state:
      | "ready"
      | "not-needed"
      | "recoverable"
      | "force-required"
      | "blocked"
      | "not-recoverable";
    forceRequired: boolean;
    forceReasons: string[];
    blockedReasons: string[];
    warnings: string[];
    gitState: TaskRecoveryGitState;
    forceModes?: {
      reset: string;
      reconcile: string;
    };
    recommendation?: string;
  };
  graph?: TaskStatusGraphFacts;
}

export interface BuildTaskStatusReportOptions {
  rootDir?: string;
  worktree?: string;
  backlogDir?: string;
  includeGraph?: boolean;
}

const FORMAL_RELATIONSHIP_TYPES = new Set<StatusRelationshipType>([
  "belongs_to",
  "depends_on",
  "implements",
]);
const NON_INFORMATIONAL_LINK_KEYS = new Set(["depends_on", "evidence"]);

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function asLinkTarget(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return asString(record.ref) ?? asString(record.link);
}

function asLinkArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asLinkTarget(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function stripWikiLink(value: string): string {
  return value.replace(/^\[\[/u, "").replace(/\]\]$/u, "").split("|", 1)[0]!.trim();
}

function stripMarkdownExtension(value: string): string {
  return value.replace(/\.md$/iu, "");
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function parseRelationshipReferences(
  sections: CanonicalTaskBodySection[],
): AuthoredStatusReference[] {
  const relationshipSection = sections.find(
    (section) => section.title.trim().toLowerCase() === "relationships",
  );
  if (!relationshipSection) {
    return [];
  }

  return relationshipSection.content
    .split(/\r?\n/u)
    .map((line) => line.match(/^\s*-\s*`([^`]+)`:\s*(.+)$/u))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      sourceKey: (match[1] ?? "").trim().toLowerCase(),
      target: (match[2] ?? "").trim(),
    }))
    .flatMap<AuthoredStatusReference>(({ sourceKey, target }) => {
      switch (sourceKey) {
        case "depends_on":
        case "implements":
          return [{ scope: "formal", sourceKey, target }];
        case "part_of":
        case "belongs_to":
          return [
            {
              scope: "formal",
              sourceKey,
              target,
            },
          ];
        default:
          return [];
      }
    });
}

function stableUniqueReferences(
  values: readonly AuthoredStatusReference[],
): AuthoredStatusReference[] {
  const unique = new Map<string, AuthoredStatusReference>();
  for (const value of values) {
    unique.set(`${value.scope}\u0000${value.sourceKey}\u0000${value.target}`, value);
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.scope.localeCompare(right.scope) ||
      left.sourceKey.localeCompare(right.sourceKey) ||
      left.target.localeCompare(right.target),
  );
}

function collectAuthoredStatusReferences(options: {
  dependencies: Array<{ target: string }>;
  links: Record<string, unknown>;
  bodySections: CanonicalTaskBodySection[];
}): AuthoredStatusReference[] {
  const formal = options.dependencies.map((dependency) => ({
    scope: "formal" as const,
    sourceKey: "depends_on",
    target: dependency.target,
  }));

  const informational = Object.entries(options.links).flatMap(([sourceKey, value]) => {
    if (NON_INFORMATIONAL_LINK_KEYS.has(sourceKey)) {
      return [];
    }
    return asLinkArray(value).map((target) => ({
      scope: "informational" as const,
      sourceKey,
      target,
    }));
  });

  return stableUniqueReferences([
    ...formal,
    ...informational,
    ...parseRelationshipReferences(options.bodySections),
  ]);
}

function displayTarget(edge: WorkGraphEdge): string | undefined {
  return asString(edge.properties.rawTarget) ?? asString(edge.properties.subject);
}

function stableUniqueRelationships(
  values: readonly TaskStatusGraphRelationship[],
): TaskStatusGraphRelationship[] {
  const unique = new Map<string, TaskStatusGraphRelationship>();
  for (const value of values) {
    unique.set(`${value.type}\u0000${value.target}`, value);
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.type.localeCompare(right.type) || left.target.localeCompare(right.target),
  );
}

function stableUniqueInformationalReferences(
  values: readonly TaskStatusGraphInformationalReference[],
): TaskStatusGraphInformationalReference[] {
  const unique = new Map<string, TaskStatusGraphInformationalReference>();
  for (const value of values) {
    unique.set(
      `${value.sourceKey}\u0000${value.target}\u0000${value.resolvedTargetId}`,
      value,
    );
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.sourceKey.localeCompare(right.sourceKey) ||
      left.target.localeCompare(right.target) ||
      left.resolvedTargetId.localeCompare(right.resolvedTargetId),
  );
}

function stableUniqueProjectionDiagnostics(
  values: readonly TaskStatusGraphProjectionDiagnostic[],
): TaskStatusGraphProjectionDiagnostic[] {
  const unique = new Map<string, TaskStatusGraphProjectionDiagnostic>();
  for (const value of values) {
    unique.set(
      [
        value.scope,
        value.sourceKey,
        value.target,
        value.classification,
        value.reasonCode,
        value.relativePath ?? "",
        value.documentId ?? "",
      ].join("\u0000"),
      value,
    );
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.scope.localeCompare(right.scope) ||
      left.sourceKey.localeCompare(right.sourceKey) ||
      left.target.localeCompare(right.target) ||
      left.reasonCode.localeCompare(right.reasonCode) ||
      (left.relativePath ?? "").localeCompare(right.relativePath ?? "") ||
      (left.documentId ?? "").localeCompare(right.documentId ?? ""),
  );
}

function referenceTokens(taskFilePath: string, target: string): Set<string> {
  const stripped = stripWikiLink(target);
  const tokens = new Set<string>();
  tokens.add(normalizeToken(stripped));
  tokens.add(normalizeToken(path.posix.basename(stripped)));
  tokens.add(normalizeToken(stripMarkdownExtension(path.posix.basename(stripped))));

  if (stripped.includes("/")) {
    const resolvedPath = stripped.startsWith("/")
      ? stripped.replace(/^\/+/u, "")
      : path.posix.normalize(path.posix.join(path.posix.dirname(taskFilePath), stripped));
    tokens.add(normalizeToken(resolvedPath));
    tokens.add(normalizeToken(path.posix.basename(resolvedPath)));
    tokens.add(
      normalizeToken(stripMarkdownExtension(path.posix.basename(resolvedPath))),
    );
  }

  return tokens;
}

function nodeReferenceTokens(node: {
  id: string;
  source: { filePath?: string };
  properties: Record<string, unknown>;
}): Set<string> {
  const tokens = new Set<string>();
  tokens.add(normalizeToken(node.id));

  const frontmatterId = asString(node.properties.frontmatterId);
  if (frontmatterId) {
    tokens.add(normalizeToken(frontmatterId));
  }

  const filePath = node.source.filePath;
  if (filePath) {
    tokens.add(normalizeToken(filePath));
    tokens.add(normalizeToken(path.posix.basename(filePath)));
    tokens.add(normalizeToken(stripMarkdownExtension(path.posix.basename(filePath))));
  }

  return tokens;
}

function referenceMatchesEdge(options: {
  authored: AuthoredStatusReference;
  taskFilePath: string;
  edge: WorkGraphEdge;
  targetNode?: {
    id: string;
    source: { filePath?: string };
    properties: Record<string, unknown>;
  };
}): boolean {
  const sourceKey = asString(options.edge.properties.sourceKey);
  if (sourceKey !== options.authored.sourceKey) {
    return false;
  }

  const authoredTokens = referenceTokens(
    options.taskFilePath,
    options.authored.target,
  );
  const edgeTokens = new Set<string>();
  const rawTarget = displayTarget(options.edge);
  if (rawTarget) {
    edgeTokens.add(normalizeToken(rawTarget));
  }

  const resolvedTargetId =
    asString(options.edge.properties.resolvedTargetId) ?? options.edge.to;
  edgeTokens.add(normalizeToken(resolvedTargetId));
  edgeTokens.add(normalizeToken(options.edge.to));

  if (options.targetNode) {
    for (const token of nodeReferenceTokens(options.targetNode)) {
      edgeTokens.add(token);
    }
  }

  for (const token of edgeTokens) {
    if (authoredTokens.has(token)) {
      return true;
    }
  }

  return false;
}

function matchProjectionDiagnostic(
  authored: AuthoredStatusReference,
  taskFilePath: string,
  diagnostics: readonly WorkGraphProjectionDiagnostic[],
): WorkGraphProjectionDiagnostic | undefined {
  const tokens = referenceTokens(taskFilePath, authored.target);
  return diagnostics.find((diagnostic) => {
    if (tokens.has(normalizeToken(diagnostic.relativePath))) {
      return true;
    }
    if (diagnostic.documentId && tokens.has(normalizeToken(diagnostic.documentId))) {
      return true;
    }
    return tokens.has(
      normalizeToken(stripMarkdownExtension(path.posix.basename(diagnostic.relativePath))),
    );
  });
}

async function collectTaskStatusGraphFacts(options: {
  task: TaskModel;
  rootDir: string;
  backlogDir: string;
}): Promise<TaskStatusGraphFacts> {
  const canonicalTask = await loadCanonicalTask({
    rootDir: options.rootDir,
    backlogDir: options.backlogDir,
    taskId: options.task.id,
  });
  const projection = await projectWorkGraph({
    rootDir: options.rootDir,
    workspaceDirs: [...new Set([options.backlogDir, "docs"])],
  });
  const taskNodeId = canonicalizeWorkItemScopeRef(options.task.id);
  const outgoingEdges = projection.getOutgoingEdges(taskNodeId);
  const formalEdges = outgoingEdges.filter(
    (edge): edge is WorkGraphEdge =>
      edge.authority === "formal" &&
      FORMAL_RELATIONSHIP_TYPES.has(edge.type as StatusRelationshipType),
  );
  const informationalEdges = outgoingEdges.filter(
    (edge): edge is WorkGraphEdge =>
      edge.authority === "informational" && edge.type === "references",
  );

  const relationships = stableUniqueRelationships(
    formalEdges
      .map((edge) => {
        const target = displayTarget(edge);
        if (!target) {
          return null;
        }
        return {
          type: edge.type as StatusRelationshipType,
          target,
        };
      })
      .filter((entry): entry is TaskStatusGraphRelationship => entry !== null),
  );
  const informationalReferences = stableUniqueInformationalReferences(
    informationalEdges
      .map((edge) => {
        const sourceKey = asString(edge.properties.sourceKey);
        const target = displayTarget(edge);
        const resolvedTargetId = asString(edge.properties.resolvedTargetId) ?? edge.to;
        if (!sourceKey || !target || !resolvedTargetId) {
          return null;
        }
        return {
          type: "references" as const,
          sourceKey,
          target,
          resolvedTargetId,
        };
      })
      .filter(
        (entry): entry is TaskStatusGraphInformationalReference => entry !== null,
      ),
  );

  const authoredReferences = collectAuthoredStatusReferences({
    dependencies: canonicalTask.dependencies,
    links: canonicalTask.validation.links as Record<string, unknown>,
    bodySections: canonicalTask.body.sections,
  });
  const projectionDiagnostics = stableUniqueProjectionDiagnostics(
    authoredReferences
      .filter((reference) => {
        const candidateEdges =
          reference.scope === "formal" ? formalEdges : informationalEdges;
        return !candidateEdges.some((edge) =>
          referenceMatchesEdge({
            authored: reference,
            taskFilePath: canonicalTask.filePath,
            edge,
            targetNode: projection.findNode(edge.to),
          }),
        );
      })
      .map((reference) => {
        const diagnostic = matchProjectionDiagnostic(
          reference,
          canonicalTask.filePath,
          projection.diagnostics,
        );
        if (!diagnostic) {
          return {
            scope: reference.scope,
            sourceKey: reference.sourceKey,
            target: reference.target,
            classification: "unresolved" as const,
            reasonCode: "unresolved-target" as const,
          };
        }
        return {
          scope: reference.scope,
          sourceKey: reference.sourceKey,
          target: reference.target,
          classification: diagnostic.classification,
          reasonCode: diagnostic.reasonCode,
          relativePath: diagnostic.relativePath,
          documentId: diagnostic.documentId,
        };
      }),
  );

  return {
    relationships,
    diagnostics: {
      projection: projectionDiagnostics,
      informationalReferences,
    },
  };
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

export async function buildTaskStatusReport(
  task: TaskModel,
  options: BuildTaskStatusReportOptions = {},
): Promise<TaskStatusReport> {
  const rootDir = path.resolve(
    options.rootDir ?? options.worktree ?? process.cwd(),
  );
  const gitState = collectTaskRecoveryGitState({
    rootDir,
    taskFilePath: task.filePath,
    expectedBranch: task.runtime?.latestExecutionLog?.branch,
    expectedWorktree:
      options.worktree ?? task.runtime?.latestExecutionLog?.worktree,
  });
  const recoverable = isRecoverableReadyRuntimeState({
    status: task.status,
    runtime: task.runtime,
    gitState,
  });
  const recoverableWithForce = isRecoverableReadyRuntimeState({
    status: task.status,
    runtime: task.runtime,
    gitState,
    allowUncertainLineage: true,
  });
  const blockedReasons = [
    ...gitState.resumeBlockedReasons,
    ...(task.runtime?.latestExecutionLog?.claimState === "active"
      ? ["claim-active"]
      : []),
    ...((task.runtime?.latestExecutionLog?.lockCount ?? 0) > 0
      ? ["locks-active"]
      : []),
  ];
  const forceReasons =
    !recoverable && recoverableWithForce ? [...gitState.resumeWarnings] : [];
  const state: TaskStatusReport["recovery"]["state"] = task.runtime?.ready
    ? "ready"
    : !task.runtime?.latestExecutionLog
    ? "not-needed"
    : recoverable
    ? "recoverable"
    : recoverableWithForce
    ? "force-required"
    : blockedReasons.length > 0
    ? "blocked"
    : "not-recoverable";

  const report: TaskStatusReport = {
    schemaVersion: "task-status/v1",
    id: task.id,
    title: task.title,
    filePath: task.filePath,
    status: task.status,
    ...(task.statusReason ? { statusReason: task.statusReason } : {}),
    lifecycle: task.lifecycle,
    validation: task.validation,
    ...(task.runtime ? { runtime: task.runtime } : {}),
    recovery: {
      state,
      forceRequired: state === "force-required",
      forceReasons,
      blockedReasons,
      warnings: gitState.resumeWarnings,
      gitState,
      ...(state === "force-required"
        ? {
            forceModes: {
              reset:
                "Discard recoverable dirty paths before marking the task ready again.",
              reconcile:
                "Save a recovery checkpoint before discarding recoverable dirty paths.",
            },
            recommendation:
              "Inspect the current branch and dirty paths first. Pass --worktree when you can identify the intended recovery checkout. Use --force reset only when this checkout is the intended task branch and task-local dirty paths can be discarded; use --force reconcile when you want a checkpoint first.",
          }
        : {}),
    },
  };

  if (options.includeGraph === false) {
    return report;
  }

  return {
    ...report,
    graph: await collectTaskStatusGraphFacts({
      task,
      rootDir,
      backlogDir: options.backlogDir ?? "backlog",
    }),
  };
}

export function formatTaskStatusText(report: TaskStatusReport): string {
  const latest = report.runtime?.latestExecutionLog;
  const lines = [
    `${report.id} | ${report.status} | ${report.title}`,
    `Path: ${report.filePath}`,
    "",
    "Readiness",
    `- markdown: ${report.runtime?.markdownReady ? "ready" : "not ready"}`,
    `- execution: ${report.runtime?.executionReady ? "ready" : "not ready"}`,
    `- effective: ${report.runtime?.ready ? "ready" : "not ready"}`,
    `- source disagreement: ${yesNo(
      report.runtime?.sourceDisagreement ?? false,
    )}`,
  ];
  if (latest) {
    lines.push(
      `- latest execution: ${latest.state}/${latest.reason} claim=${
        latest.claimState ?? "unknown"
      } locks=${latest.lockCount ?? "unknown"}`,
    );
  }

  if (
    report.graph &&
    (report.graph.relationships.length > 0 ||
      report.graph.diagnostics.informationalReferences.length > 0 ||
      report.graph.diagnostics.projection.length > 0)
  ) {
    lines.push("", "Graph");
    if (report.graph.relationships.length > 0) {
      lines.push(
        `- relationships: ${report.graph.relationships
          .map((relationship) => `${relationship.type}=${relationship.target}`)
          .join(", ")}`,
      );
    }
    if (report.graph.diagnostics.informationalReferences.length > 0) {
      lines.push(
        `- informational references: ${report.graph.diagnostics.informationalReferences
          .map((reference) => `${reference.sourceKey}=${reference.target}`)
          .join(", ")}`,
      );
    }
    if (report.graph.diagnostics.projection.length > 0) {
      lines.push(
        `- projection diagnostics: ${report.graph.diagnostics.projection
          .map(
            (diagnostic) =>
              `${diagnostic.sourceKey}=${diagnostic.target} (${diagnostic.reasonCode})`,
          )
          .join(", ")}`,
      );
    }
  }

  lines.push(
    "",
    "Recovery",
    `- state: ${report.recovery.state}`,
    `- force required: ${yesNo(report.recovery.forceRequired)}`,
  );
  if (report.recovery.forceReasons.length > 0) {
    lines.push(`- force reasons: ${report.recovery.forceReasons.join(", ")}`);
  }
  if (report.recovery.blockedReasons.length > 0) {
    lines.push(
      `- blocked reasons: ${report.recovery.blockedReasons.join(", ")}`,
    );
  }
  if (report.recovery.recommendation) {
    lines.push(`- recommendation: ${report.recovery.recommendation}`);
  }
  lines.push(
    "",
    "Git",
    `- current branch: ${report.recovery.gitState.currentBranch ?? "unknown"}`,
    `- expected branch: ${
      report.recovery.gitState.expectedBranch ?? "unknown"
    }`,
    `- current worktree: ${report.recovery.gitState.currentWorktree}`,
    `- expected worktree: ${
      report.recovery.gitState.expectedWorktree ?? "unknown"
    }`,
    `- lineage known: ${yesNo(report.recovery.gitState.lineageKnown)}`,
    `- branch lineage known: ${yesNo(
      report.recovery.gitState.branchLineageKnown,
    )}`,
    `- worktree lineage known: ${yesNo(
      report.recovery.gitState.worktreeLineageKnown,
    )}`,
    `- merge/rebase in progress: ${yesNo(
      report.recovery.gitState.mergeInProgress ||
        report.recovery.gitState.rebaseInProgress,
    )}`,
    `- dirty paths: ${report.recovery.gitState.dirtyPaths.length}`,
    `- task path dirty: ${yesNo(report.recovery.gitState.taskPathDirty)}`,
  );
  return lines.join("\n");
}
