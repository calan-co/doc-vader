import matter from "gray-matter";
import { promises as fs } from "node:fs";
import path from "node:path";
import { TaskCommandError } from "./errors.js";
import {
  loadTaskRuntimeReadiness,
  type TaskRuntimeReadiness,
} from "./runtime.js";
import {
  evaluateWorkItemGovernance,
  type WorkItemGovernanceDependency,
} from "../work-management/kernel.js";

type Frontmatter = Record<string, unknown>;

export interface TaskDependency {
  id: string;
  ref: string;
  status?: string;
  lifecycle?: string;
  filePath?: string;
  satisfied: boolean;
}

export interface TaskBodySection {
  heading: string;
  body: string;
}

export interface TaskAcceptanceCriterion {
  text: string;
  checked: boolean;
}

export interface TaskModel {
  id: string;
  numericId?: string;
  title: string;
  summary?: string;
  filePath: string;
  status: string;
  statusReason?: string;
  lifecycle: string;
  type: string;
  subtype?: string;
  priority?: string;
  estimated?: number;
  actual?: number;
  tags: string[];
  dependencies: TaskDependency[];
  references: string[];
  bodySections: TaskBodySection[];
  acceptanceCriteria: TaskAcceptanceCriterion[];
  validation: {
    isActive: boolean;
    isReady: boolean;
    isAfk: boolean;
    isHitl: boolean;
    dependenciesSatisfied: boolean;
  };
  runtime?: TaskRuntimeReadiness;
}

interface TaskDocument {
  filePath: string;
  frontmatter: Frontmatter;
  body: string;
  archived: boolean;
}

export interface LoadTaskOptions {
  rootDir?: string;
  backlogDir?: string;
}

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

async function readTaskDocuments(
  rootDir: string,
  backlogDir: string,
): Promise<TaskDocument[]> {
  const backlogRoot = path.resolve(rootDir, backlogDir);
  const files = await findMarkdownFiles(backlogRoot);
  const documents: TaskDocument[] = [];
  for (const filePath of files) {
    const relative = toPosixPath(path.relative(backlogRoot, filePath));
    if (relative.startsWith("audit/") || relative.startsWith("records/")) {
      continue;
    }
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = matter(raw);
    if (parsed.data?.type !== "work-item") {
      continue;
    }
    documents.push({
      filePath,
      frontmatter: (parsed.data ?? {}) as Frontmatter,
      body: parsed.content,
      archived: relative.startsWith("archive/"),
    });
  }
  return documents;
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stripWikiLink(value: string): string {
  return value.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
}

function normalizeDependencyId(ref: string): string {
  const stripped = stripWikiLink(ref);
  const match = stripped.match(/^(\d+)/);
  return match ? `wi-${match[1]}` : stripped;
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

function parseSections(body: string): TaskBodySection[] {
  const sections: TaskBodySection[] = [];
  const headingRegex = /^##\s+(.+)$/gm;
  const matches = [...body.matchAll(headingRegex)];
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const next = matches[i + 1];
    const heading = (match?.[1] ?? "").trim();
    const start = (match?.index ?? 0) + (match?.[0].length ?? 0);
    const end = next?.index ?? body.length;
    sections.push({
      heading,
      body: body.slice(start, end).trim(),
    });
  }
  return sections;
}

function parseAcceptanceCriteria(
  sections: TaskBodySection[],
): TaskAcceptanceCriterion[] {
  const section = sections.find(
    (entry) => entry.heading.trim().toLowerCase() === "acceptance criteria",
  );
  if (!section) {
    return [];
  }
  return section.body
    .split("\n")
    .map((line) => line.match(/^\s*-\s+\[( |x|X)\]\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      checked: (match[1] ?? "").toLowerCase() === "x",
      text: (match[2] ?? "").trim(),
    }));
}

function matchesTaskIdentifier(document: TaskDocument, taskId: string): boolean {
  const normalized = taskId.trim();
  const frontmatterId = asString(document.frontmatter.id);
  const basename = path.basename(document.filePath, ".md");
  return (
    frontmatterId === normalized ||
    frontmatterId === `wi-${normalized}` ||
    frontmatterId?.replace(/^wi-/, "") === normalized ||
    basename === normalized ||
    basename.startsWith(`${normalized}-`)
  );
}

function assertValidTaskDocument(document: TaskDocument): void {
  const id = asString(document.frontmatter.id);
  if (!id) {
    throw new TaskCommandError("TASK_INVALID", "Task is missing an id.", {
      filePath: document.filePath,
    });
  }
  if (document.archived) {
    throw new TaskCommandError(
      "TASK_ARCHIVED",
      `Task '${id}' is archived and cannot be used for dogfood execution.`,
      { id, filePath: document.filePath },
    );
  }
  if (asString(document.frontmatter.type) !== "work-item") {
    throw new TaskCommandError("TASK_INVALID", "Task is not a work item.", {
      id,
      filePath: document.filePath,
    });
  }
}

function toDependency(
  ref: string,
  documents: TaskDocument[],
  rootDir: string,
): TaskDependency {
  const id = normalizeDependencyId(ref);
  const dependency = documents.find(
    (document) =>
      asString(document.frontmatter.id) === id ||
      asString(document.frontmatter.id)?.replace(/^wi-/, "") ===
        id.replace(/^wi-/, "") ||
      path.basename(document.filePath, ".md") === stripWikiLink(ref),
  );
  const status = asString(dependency?.frontmatter.status);
  const lifecycle = asString(dependency?.frontmatter.lifecycle);
  return {
    id,
    ref,
    ...(status ? { status } : {}),
    ...(lifecycle ? { lifecycle } : {}),
    ...(dependency
      ? { filePath: toPosixPath(path.relative(rootDir, dependency.filePath)) }
      : {}),
    satisfied: status === "completed" || status === "closed" || lifecycle === "inactive",
  };
}

function toGovernanceDependency(
  ref: string,
  documents: TaskDocument[],
  rootDir: string,
): WorkItemGovernanceDependency {
  const id = normalizeDependencyId(ref);
  const dependency = documents.find(
    (document) =>
      asString(document.frontmatter.id) === id ||
      asString(document.frontmatter.id)?.replace(/^wi-/, "") ===
        id.replace(/^wi-/, "") ||
      path.basename(document.filePath, ".md") === stripWikiLink(ref),
  );
  const status = asString(dependency?.frontmatter.status);
  const lifecycle = asString(dependency?.frontmatter.lifecycle);
  return {
    id,
    ref,
    ...(status ? { status } : {}),
    ...(lifecycle ? { lifecycle } : {}),
    ...(dependency
      ? { filePath: toPosixPath(path.relative(rootDir, dependency.filePath)) }
      : {}),
    satisfied: status === "completed" || status === "closed" || lifecycle === "inactive",
    stateKnown: Boolean(dependency && status),
  };
}

export async function loadTaskModel(
  taskId: string,
  options: LoadTaskOptions = {},
): Promise<TaskModel> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const backlogDir = options.backlogDir ?? "backlog";
  const documents = await readTaskDocuments(rootDir, backlogDir);
  const matches = documents.filter((document) =>
    matchesTaskIdentifier(document, taskId),
  );
  if (matches.length === 0) {
    throw new TaskCommandError("TASK_NOT_FOUND", `Task '${taskId}' not found.`, {
      taskId,
    });
  }
  if (matches.length > 1) {
    throw new TaskCommandError(
      "TASK_AMBIGUOUS",
      `Task '${taskId}' matched multiple work items.`,
      {
        taskId,
        matches: matches.map((match) =>
          toPosixPath(path.relative(rootDir, match.filePath)),
        ),
      },
    );
  }

  return buildTaskModel(matches[0] as TaskDocument, documents, rootDir);
}

async function buildTaskModel(
  document: TaskDocument,
  documents: TaskDocument[],
  rootDir: string,
): Promise<TaskModel> {
  assertValidTaskDocument(document);

  const frontmatter = document.frontmatter;
  const id = asString(frontmatter.id) ?? "";
  const links = getLinks(frontmatter);
  const dependencyRefs = collectStringLinks(links.depends_on);
  const title = asString(frontmatter.title);
  const summary = asString(frontmatter.summary);
  const status = asString(frontmatter.status) ?? "";
  const lifecycle = asString(frontmatter.lifecycle) ?? "";
  const statusReason = asString(frontmatter.status_reason);
  const completedDate = asString(frontmatter.completed_date);
  const tags = normalizeTags(frontmatter.tags);
  const type = asString(frontmatter.type) ?? "";
  const subtype = asString(frontmatter.subtype);
  const priority = asString(frontmatter.priority);
  const numericId = id.match(/^wi-(\d+)/)?.[1];
  const sections = parseSections(document.body);
  const governance = evaluateWorkItemGovernance({
    id,
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(lifecycle ? { lifecycle } : {}),
    tags,
    archived: document.archived || lifecycle === "archived",
    ...(statusReason ? { statusReason } : {}),
    ...(completedDate ? { completedDate } : {}),
    links,
    dependencies: dependencyRefs.map((ref) => toGovernanceDependency(ref, documents, rootDir)),
  });
  const dependencies = dependencyRefs.map((ref) => toDependency(ref, documents, rootDir));
  const runtime = await loadTaskRuntimeReadiness({
    rootDir,
    taskId: id,
    markdownReady: governance.readiness.ready,
  });
  return {
    id,
    ...(numericId ? { numericId } : {}),
    title: title ?? id,
    ...(summary ? { summary } : {}),
    filePath: toPosixPath(path.relative(rootDir, document.filePath)),
    status,
    ...(statusReason ? { statusReason } : {}),
    lifecycle,
    type,
    ...(subtype ? { subtype } : {}),
    ...(priority ? { priority } : {}),
    ...(asNumber(frontmatter.estimated) !== undefined
      ? { estimated: asNumber(frontmatter.estimated) }
      : {}),
    ...(asNumber(frontmatter.actual) !== undefined
      ? { actual: asNumber(frontmatter.actual) }
      : {}),
    tags,
    dependencies,
    references: collectStringLinks(links.reference),
    bodySections: sections,
    acceptanceCriteria: parseAcceptanceCriteria(sections),
    validation: {
      isActive: governance.lifecycle.isActive,
      isReady: status === "ready",
      isAfk: governance.classification.isAfk,
      isHitl: governance.classification.isHitl,
      dependenciesSatisfied: governance.dependencies.satisfied,
    },
    runtime,
  };
}

export async function listTaskModels(
  options: LoadTaskOptions = {},
): Promise<TaskModel[]> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const backlogDir = options.backlogDir ?? "backlog";
  const documents = await readTaskDocuments(rootDir, backlogDir);
  return Promise.all(
    documents
      .filter((document) => {
        return (
          !document.archived &&
          asString(document.frontmatter.lifecycle) !== "archived" &&
          asString(document.frontmatter.status) !== "closed" &&
          asString(document.frontmatter.status) !== "completed"
        );
      })
      .map((document) => buildTaskModel(document, documents, rootDir)),
  );
}
