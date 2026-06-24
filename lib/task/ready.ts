import matter from "gray-matter";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  evaluateWorkItemGovernance,
  type WorkItemGovernanceDependency,
  type WorkItemGovernanceReason,
} from "../work-management/kernel.js";
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
  currentGitBranch,
  listGitWorktrees,
  resolveTaskAuthorityFromGitContext,
  type TaskAuthorityGitContext,
} from "./authority.js";

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
}

export interface ReadyTaskExclusion {
  id?: string;
  filePath: string;
  title?: string;
  runtime?: TaskRuntimeReadiness;
  reasons: Array<{
    code: ReadyExclusionCode;
    message: string;
    details?: Record<string, unknown>;
  }>;
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
  frontmatter?: Frontmatter;
  parseError?: string;
}

interface ReadyAuthorityContext {
  git: TaskAuthorityGitContext;
  documentsByRoot: Map<string, Promise<ReadyDocument[]>>;
  runtimeByRootAndTask: Map<string, Promise<Map<string, TaskRuntimeExecutionLog>>>;
}

export interface SelectReadyTasksOptions {
  rootDir?: string;
  backlogDir?: string;
  claimStorePath?: string;
  now?: Date;
}

const NON_TASK_PATH_PREFIXES = ["audit/", "records/"] as const;

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
  return value.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
}

function normalizeDependencyId(ref: string): string {
  const stripped = stripWikiLink(ref);
  const match = stripped.match(/^(?:wi-)?(\d+)/);
  return match ? `wi-${match[1]}` : stripped;
}

function documentTaskId(document: ReadyDocument): string | undefined {
  return document.frontmatter ? asString(document.frontmatter.id) : undefined;
}

function documentKeys(document: ReadyDocument): string[] {
  const basename = path.basename(document.filePath, ".md");
  const id = documentTaskId(document);
  return [
    ...(id ? [id, id.replace(/^wi-/, "")] : []),
    basename,
    ...(basename.match(/^(\d+)/)?.[1] ? [basename.match(/^(\d+)/)?.[1] as string] : []),
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
    const keys = documentKeys(document);
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
    satisfied: status === "completed" || status === "closed" || lifecycle === "inactive",
    stateKnown: Boolean(dependency && !dependency.parseError && status),
  };
}

function toGovernanceDependency(
  ref: string,
  documents: ReadyDocument[],
): WorkItemGovernanceDependency {
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
    satisfied: status === "completed" || status === "closed" || lifecycle === "inactive",
    stateKnown: Boolean(dependency && !dependency.parseError && status),
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
  };
}

async function evaluateDocument(
  rootDir: string,
  document: ReadyDocument,
  documents: ReadyDocument[],
  latestExecutionLog?: TaskRuntimeExecutionLog,
): Promise<{ candidate?: ReadyTaskCandidate; exclusion?: ReadyTaskExclusion }> {
  if (document.parseError) {
    return {
      exclusion: {
        filePath: document.relativePath,
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
  const dependencyRefs = collectStringLinks(links.depends_on);
  const dependencies = dependencyRefs.map((ref) => toDependency(ref, documents));
  const governance = evaluateWorkItemGovernance({
    id: id ?? "",
    ...(title ? { title } : {}),
    status: status ?? "",
    lifecycle: lifecycle ?? "",
    tags,
    archived: document.archived || lifecycle === "archived",
    links,
    dependencies: dependencyRefs.map((ref) => toGovernanceDependency(ref, documents)),
  });
  const reasons: ReadyTaskExclusion["reasons"] = governance.readiness.reasons.map(
    toReadyReason,
  );
  const readiness = composeTaskRuntimeReadiness(
    governance.readiness.ready,
    latestExecutionLog,
  );
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

  if (claimability.failures.includes("execution-not-ready")) {
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
        reasons,
      },
    };
  }

  return {
    candidate: {
      ...toCandidate(document, dependencies),
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
        },
        authorityContext.git,
      )
    : {
        rootDir,
      };
  if (authority.rootDir === rootDir) {
    return evaluateDocument(rootDir, document, documents, latestExecutionLog);
  }

  const documentsPromise = authorityContext?.documentsByRoot.get(authority.rootDir)
    ?? readReadyDocuments(authority.rootDir, backlogDir);
  authorityContext?.documentsByRoot.set(authority.rootDir, documentsPromise);
  const authorityDocuments = await documentsPromise;
  const authorityDocument = authorityDocuments.find(
    (candidate) => asString(candidate.frontmatter?.id) === taskId,
  );
  if (!authorityDocument) {
    return evaluateDocument(rootDir, document, documents, latestExecutionLog);
  }

  const runtimeKey = `${authority.rootDir}\0${taskId}`;
  const runtimePromise = authorityContext?.runtimeByRootAndTask.get(runtimeKey)
    ?? loadTaskExecutionLogSummaries({
      rootDir: authority.rootDir,
      taskIds: [taskId],
    });
  authorityContext?.runtimeByRootAndTask.set(runtimeKey, runtimePromise);
  const authorityRuntime = await runtimePromise;
  return evaluateDocument(
    authority.rootDir,
    authorityDocument,
    authorityDocuments,
    authorityRuntime.get(taskId),
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
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const backlogDir = options.backlogDir ?? "backlog";
  const documents = await readReadyDocuments(rootDir, backlogDir);
  const taskIds = documents
    .map((document) => asString(document.frontmatter?.id))
    .filter((id): id is string => Boolean(id));
  const runtimeSummaries = await loadTaskExecutionLogSummaries({
    rootDir,
    taskIds,
  });
  const authorityContext: ReadyAuthorityContext = {
    git: {
      currentBranch: currentGitBranch(rootDir),
      worktrees: listGitWorktrees(rootDir),
    },
    documentsByRoot: new Map([[rootDir, Promise.resolve(documents)]]),
    runtimeByRootAndTask: new Map(),
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
  lines.push("Ready task candidates");
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
    lines.push("Run `dv task recover <task-id>` to make a recoverable task claimable again.");
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
