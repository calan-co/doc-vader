import matter from "gray-matter";
import { promises as fs } from "node:fs";
import path from "node:path";
import { TaskCommandError } from "./errors.js";

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
    satisfied: status === "closed" || lifecycle === "inactive",
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

  const document = matches[0] as TaskDocument;
  assertValidTaskDocument(document);

  const frontmatter = document.frontmatter;
  const id = asString(frontmatter.id) as string;
  const links = getLinks(frontmatter);
  const sections = parseSections(document.body);
  const dependencies = collectStringLinks(links.depends_on).map((ref) =>
    toDependency(ref, documents, rootDir),
  );
  const tags = normalizeTags(frontmatter.tags);
  const status = asString(frontmatter.status) ?? "";
  const lifecycle = asString(frontmatter.lifecycle) ?? "";
  return {
    id,
    ...(id.match(/^wi-(\d+)/)?.[1]
      ? { numericId: id.match(/^wi-(\d+)/)?.[1] }
      : {}),
    title: asString(frontmatter.title) ?? id,
    ...(asString(frontmatter.summary)
      ? { summary: asString(frontmatter.summary) }
      : {}),
    filePath: toPosixPath(path.relative(rootDir, document.filePath)),
    status,
    ...(asString(frontmatter.status_reason)
      ? { statusReason: asString(frontmatter.status_reason) }
      : {}),
    lifecycle,
    type: asString(frontmatter.type) ?? "",
    ...(asString(frontmatter.subtype)
      ? { subtype: asString(frontmatter.subtype) }
      : {}),
    ...(asString(frontmatter.priority)
      ? { priority: asString(frontmatter.priority) }
      : {}),
    ...(asNumber(frontmatter.estimated)
      ? { estimated: asNumber(frontmatter.estimated) }
      : {}),
    ...(asNumber(frontmatter.actual) ? { actual: asNumber(frontmatter.actual) } : {}),
    tags,
    dependencies,
    references: collectStringLinks(links.reference),
    bodySections: sections,
    acceptanceCriteria: parseAcceptanceCriteria(sections),
    validation: {
      isActive: lifecycle === "active",
      isReady: status === "ready",
      isAfk: tags.includes("afk"),
      isHitl: tags.includes("hitl"),
      dependenciesSatisfied: dependencies.every(
        (dependency) => dependency.satisfied,
      ),
    },
  };
}
