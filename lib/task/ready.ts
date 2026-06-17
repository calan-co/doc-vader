import matter from "gray-matter";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getClaimStatusForTask, type ClaimStatus } from "./claims.js";

type Frontmatter = Record<string, unknown>;

export type ReadyExclusionCode =
  | "archived"
  | "blocked"
  | "closed"
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
}

export interface ReadyTaskExclusion {
  id?: string;
  filePath: string;
  title?: string;
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
    satisfied: status === "closed" || lifecycle === "inactive",
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

function toCandidate(
  document: ReadyDocument,
  dependencies: ReadyTaskDependency[],
): ReadyTaskCandidate {
  const frontmatter = document.frontmatter as Frontmatter;
  const id = asString(frontmatter.id) as string;
  return {
    id,
    ...(id.match(/^wi-(\d+)/)?.[1]
      ? { numericId: id.match(/^wi-(\d+)/)?.[1] }
      : {}),
    title: asString(frontmatter.title) ?? id,
    ...(asString(frontmatter.summary)
      ? { summary: asString(frontmatter.summary) }
      : {}),
    filePath: document.relativePath,
    status: asString(frontmatter.status) ?? "",
    lifecycle: asString(frontmatter.lifecycle) ?? "",
    type: asString(frontmatter.type) ?? "",
    ...(asString(frontmatter.subtype)
      ? { subtype: asString(frontmatter.subtype) }
      : {}),
    ...(asString(frontmatter.priority)
      ? { priority: asString(frontmatter.priority) }
      : {}),
    tags: normalizeTags(frontmatter.tags),
    dependencies,
  };
}

function claimReason(status: ClaimStatus): ReadyTaskExclusion["reasons"][number] | undefined {
  if (status.state === "active") {
    return reason("task_claim_active", "Task has an active local claim.", {
      claimId: status.claimId,
      holder: status.claim?.holder,
      expiresAt: status.claim?.expiresAt,
    });
  }
  if (status.state === "expired") {
    return reason(
      "task_claim_expired",
      "Task has an expired local claim that must be released explicitly.",
      {
        claimId: status.claimId,
        holder: status.claim?.holder,
        expiresAt: status.claim?.expiresAt,
      },
    );
  }
  return undefined;
}

async function evaluateDocument(
  document: ReadyDocument,
  documents: ReadyDocument[],
  rootDir: string,
  claimStorePath: string | undefined,
  now: Date,
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
  const dependencies = collectStringLinks(getLinks(frontmatter).depends_on).map((ref) =>
    toDependency(ref, documents),
  );
  const reasons: ReadyTaskExclusion["reasons"] = [];

  if (!id || !title || !status || !lifecycle) {
    reasons.push(
      reason("invalid", "Task is missing required ready-selection metadata.", {
        missing: [
          ...(!id ? ["id"] : []),
          ...(!title ? ["title"] : []),
          ...(!status ? ["status"] : []),
          ...(!lifecycle ? ["lifecycle"] : []),
        ],
      }),
    );
  }
  if (document.archived || lifecycle === "archived") {
    reasons.push(reason("archived", "Archived tasks are not ready candidates."));
  }
  if (status === "closed" || lifecycle === "inactive") {
    reasons.push(reason("closed", "Closed tasks are not ready candidates."));
  }
  if (status === "blocked") {
    reasons.push(reason("blocked", "Blocked tasks are not ready candidates."));
  }
  if (status === "dependency-blocked") {
    reasons.push(
      reason("dependency_blocked", "Dependency-blocked tasks are not ready candidates."),
    );
  }
  if (status !== "ready") {
    reasons.push(reason("not_ready", "Task status is not ready.", { status }));
  }
  if (lifecycle !== "active") {
    reasons.push(reason("not_active", "Task lifecycle is not active.", { lifecycle }));
  }
  if (tags.includes("hitl")) {
    reasons.push(reason("hitl", "HITL tasks are not AFK-ready candidates."));
  } else if (!tags.includes("afk")) {
    reasons.push(
      reason("missing_classification", "Task is missing AFK classification.", {
        tags,
      }),
    );
  }
  const unknownDependencies = dependencies.filter((dependency) => !dependency.stateKnown);
  if (unknownDependencies.length > 0) {
    reasons.push(
      reason(
        "dependency_state_unknown",
        "Dependency state could not be determined.",
        { dependencies: unknownDependencies },
      ),
    );
  }
  const blockedDependencies = dependencies.filter(
    (dependency) => dependency.stateKnown && !dependency.satisfied,
  );
  if (blockedDependencies.length > 0) {
    reasons.push(
      reason("dependency_blocked", "Task has unsatisfied dependencies.", {
        dependencies: blockedDependencies,
      }),
    );
  }

  if (id) {
    const claimStatus = await getClaimStatusForTask(id, {
      rootDir,
      claimStorePath,
      now,
    });
    const exclusion = claimStatus ? claimReason(claimStatus) : undefined;
    if (exclusion) {
      reasons.push(exclusion);
    }
  }

  if (reasons.length > 0) {
    return {
      exclusion: {
        ...(id ? { id } : {}),
        filePath: document.relativePath,
        ...(title ? { title } : {}),
        reasons,
      },
    };
  }

  return { candidate: toCandidate(document, dependencies) };
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
  const now = options.now ?? new Date();
  const documents = await readReadyDocuments(rootDir, backlogDir);
  const results = await Promise.all(
    documents.map((document) =>
      evaluateDocument(document, documents, rootDir, options.claimStorePath, now),
    ),
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
