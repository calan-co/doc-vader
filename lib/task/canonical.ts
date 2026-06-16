import matter from "gray-matter";
import { promises as fs } from "node:fs";
import path from "node:path";
import { renderTempljsTemplate } from "../template/render.js";

type JsonObject = Record<string, unknown>;

export type TaskModelErrorCode =
  | "TASK_ID_INVALID"
  | "TASK_NOT_FOUND"
  | "TASK_AMBIGUOUS"
  | "TASK_ARCHIVED"
  | "TASK_INVALID";

export interface StructuredTaskModelError {
  ok: false;
  error: {
    code: TaskModelErrorCode;
    message: string;
    taskId: string;
    details?: JsonObject;
  };
}

export class TaskModelError extends Error {
  readonly code: TaskModelErrorCode;
  readonly taskId: string;
  readonly details?: JsonObject;

  constructor(
    code: TaskModelErrorCode,
    taskId: string,
    message: string,
    details?: JsonObject,
  ) {
    super(message);
    this.name = "TaskModelError";
    this.code = code;
    this.taskId = taskId;
    this.details = details;
  }

  toJSON(): StructuredTaskModelError {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        taskId: this.taskId,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export interface CanonicalTaskBodySection {
  title: string;
  level: number;
  content: string;
}

export interface CanonicalTaskAcceptanceCriterion {
  text: string;
  done: boolean;
}

export interface CanonicalTaskDependency {
  type: "depends_on";
  target: string;
}

export interface CanonicalTaskModel {
  schemaVersion: "task-model/v1";
  id: string;
  title: string;
  filePath: string;
  status: string;
  lifecycle: string;
  tags: string[];
  dependencies: CanonicalTaskDependency[];
  body: {
    sections: CanonicalTaskBodySection[];
  };
  acceptanceCriteria: CanonicalTaskAcceptanceCriterion[];
  validation: {
    type: string;
    subtype?: string;
    priority?: string;
    statusReason?: string;
    schema?: string;
    contentSchema?: string;
    template?: string;
    links: JsonObject;
    archived: boolean;
  };
}

export interface LoadCanonicalTaskOptions {
  rootDir?: string;
  backlogDir?: string;
  taskId: string;
}

export interface RenderCanonicalTaskOptions {
  rootDir?: string;
  templatePath?: string;
  task: CanonicalTaskModel;
}

const DEFAULT_BACKLOG_DIR = "backlog";
const HUMAN_TEMPLATE_PATH = "templates/reference/task/show.md.tpl";
const SANDCASTLE_TEMPLATE_PATH = "templates/reference/task/sandcastle-prompt.md.tpl";
const validTaskIdPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;

interface Candidate {
  filePath: string;
  relativePath: string;
  archived: boolean;
  frontmatter: JsonObject;
  body: string;
}

function resolveRoot(rootDir?: string): string {
  return path.resolve(rootDir ?? process.cwd());
}

function resolveFromRoot(rootDir: string, targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.join(rootDir, targetPath);
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function numericToken(value: string): string | null {
  const match = value.match(/^(?:wi-)?(\d+)$/i);
  return match?.[1] ?? null;
}

function assertValidTaskId(taskId: string): void {
  if (!validTaskIdPattern.test(taskId.trim())) {
    throw new TaskModelError(
      "TASK_ID_INVALID",
      taskId,
      `Task id is invalid: ${taskId}`,
      { expectedPattern: validTaskIdPattern.source },
    );
  }
}

async function walkMarkdownFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const nested = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .map(async (entry) => {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          return walkMarkdownFiles(entryPath);
        }
        return entry.isFile() && entry.name.endsWith(".md") ? [entryPath] : [];
      }),
  );
  return nested.flat().sort((a, b) => toPosixPath(a).localeCompare(toPosixPath(b)));
}

function isArchivedPath(relativePath: string): boolean {
  const posix = toPosixPath(relativePath);
  return posix === "archive" || posix.startsWith("archive/");
}

function shouldIgnorePath(relativePath: string): boolean {
  const posix = toPosixPath(relativePath);
  return posix.startsWith("audit/") || posix.startsWith("records/");
}

function candidateTokens(candidate: Candidate): string[] {
  const basename = path.basename(candidate.relativePath, ".md");
  const prefix = basename.match(/^(\d+)[.-]/)?.[1];
  const id = typeof candidate.frontmatter.id === "string" ? candidate.frontmatter.id : "";
  return [id, numericToken(id) ?? "", basename, prefix ?? ""]
    .map(normalize)
    .filter((token) => token.length > 0);
}

function matchesTaskId(candidate: Candidate, taskId: string): boolean {
  const requested = normalize(taskId);
  const requestedNumber = numericToken(requested);
  return candidateTokens(candidate).some(
    (token) => token === requested || (requestedNumber !== null && token === requestedNumber),
  );
}

async function findCandidates(backlogDir: string, taskId: string): Promise<Candidate[]> {
  const files = await walkMarkdownFiles(backlogDir);
  const candidates = await Promise.all(
    files.map(async (filePath) => {
      const relativePath = toPosixPath(path.relative(backlogDir, filePath));
      if (shouldIgnorePath(relativePath)) {
        return null;
      }
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = matter(raw);
      const candidate: Candidate = {
        filePath,
        relativePath,
        archived: isArchivedPath(relativePath),
        frontmatter: parsed.data as JsonObject,
        body: parsed.content,
      };
      return matchesTaskId(candidate, taskId) ? candidate : null;
    }),
  );
  return candidates.filter((candidate): candidate is Candidate => candidate !== null);
}

function ensureString(
  frontmatter: JsonObject,
  field: string,
  candidate: Candidate,
  taskId: string,
): string {
  const value = frontmatter[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TaskModelError(
      "TASK_INVALID",
      taskId,
      `Task ${candidate.relativePath} is missing required string field: ${field}`,
      { filePath: candidate.relativePath, field },
    );
  }
  return value;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

function normalizeLinks(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as JsonObject) }
    : {};
}

function extractDependencies(frontmatter: JsonObject): CanonicalTaskDependency[] {
  const links = normalizeLinks(frontmatter.links);
  return normalizeStringList(links.depends_on).map((target) => ({
    type: "depends_on",
    target,
  }));
}

function extractSections(body: string): CanonicalTaskBodySection[] {
  const sections: CanonicalTaskBodySection[] = [];
  const headingPattern = /^(#{2,6})\s+(.+?)\s*$/gm;
  const headings = [...body.matchAll(headingPattern)];

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const next = headings[index + 1];
    const marker = heading?.[1] ?? "";
    const title = heading?.[2]?.trim() ?? "";
    const start = (heading?.index ?? 0) + (heading?.[0]?.length ?? 0);
    const end = next?.index ?? body.length;
    sections.push({
      title,
      level: marker.length,
      content: body.slice(start, end).trim(),
    });
  }

  return sections;
}

function extractAcceptanceCriteria(
  sections: CanonicalTaskBodySection[],
): CanonicalTaskAcceptanceCriterion[] {
  const section = sections.find(
    (entry) => normalize(entry.title) === "acceptance criteria",
  );
  if (!section) {
    return [];
  }

  return section.content
    .split("\n")
    .map((line) => line.trim())
    .map((line) => {
      const checkbox = line.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
      if (checkbox) {
        return {
          text: (checkbox[2] ?? "").trim(),
          done: normalize(checkbox[1] ?? "") === "x",
        };
      }
      const bullet = line.match(/^[-*]\s+(.+)$/);
      if (bullet) {
        return {
          text: (bullet[1] ?? "").trim(),
          done: false,
        };
      }
      return null;
    })
    .filter((entry): entry is CanonicalTaskAcceptanceCriterion => entry !== null);
}

function buildTaskModel(
  candidate: Candidate,
  rootDir: string,
  taskId: string,
): CanonicalTaskModel {
  const frontmatter = candidate.frontmatter;
  const id = ensureString(frontmatter, "id", candidate, taskId);
  const title = ensureString(frontmatter, "title", candidate, taskId);
  const type = ensureString(frontmatter, "type", candidate, taskId);
  const status = ensureString(frontmatter, "status", candidate, taskId);
  const lifecycle = ensureString(frontmatter, "lifecycle", candidate, taskId);

  if (type !== "work-item") {
    throw new TaskModelError(
      "TASK_INVALID",
      taskId,
      `Task ${candidate.relativePath} is not a work item`,
      { filePath: candidate.relativePath, type },
    );
  }

  const sections = extractSections(candidate.body);

  return {
    schemaVersion: "task-model/v1",
    id,
    title,
    filePath: toPosixPath(path.relative(rootDir, candidate.filePath)),
    status,
    lifecycle,
    tags: normalizeStringList(frontmatter.tags),
    dependencies: extractDependencies(frontmatter),
    body: {
      sections,
    },
    acceptanceCriteria: extractAcceptanceCriteria(sections),
    validation: {
      type,
      subtype: typeof frontmatter.subtype === "string" ? frontmatter.subtype : undefined,
      priority: typeof frontmatter.priority === "string" ? frontmatter.priority : undefined,
      statusReason:
        typeof frontmatter.status_reason === "string"
          ? frontmatter.status_reason
          : undefined,
      schema: typeof frontmatter.$schema === "string" ? frontmatter.$schema : undefined,
      contentSchema:
        typeof frontmatter.$content_schema === "string"
          ? frontmatter.$content_schema
          : undefined,
      template:
        typeof frontmatter.$template === "string" ? frontmatter.$template : undefined,
      links: normalizeLinks(frontmatter.links),
      archived: candidate.archived,
    },
  };
}

export async function loadCanonicalTask(
  options: LoadCanonicalTaskOptions,
): Promise<CanonicalTaskModel> {
  assertValidTaskId(options.taskId);
  const rootDir = resolveRoot(options.rootDir);
  const backlogDir = resolveFromRoot(rootDir, options.backlogDir ?? DEFAULT_BACKLOG_DIR);
  const matches = await findCandidates(backlogDir, options.taskId);

  if (matches.length === 0) {
    throw new TaskModelError(
      "TASK_NOT_FOUND",
      options.taskId,
      `Task not found: ${options.taskId}`,
    );
  }

  const activeMatches = matches.filter((candidate) => !candidate.archived);
  if (activeMatches.length === 0) {
    throw new TaskModelError(
      "TASK_ARCHIVED",
      options.taskId,
      `Task is archived: ${options.taskId}`,
      { matches: matches.map((candidate) => candidate.relativePath) },
    );
  }

  if (activeMatches.length > 1) {
    throw new TaskModelError(
      "TASK_AMBIGUOUS",
      options.taskId,
      `Task id is ambiguous: ${options.taskId}`,
      { matches: activeMatches.map((candidate) => candidate.relativePath) },
    );
  }

  return buildTaskModel(activeMatches[0] as Candidate, rootDir, options.taskId);
}

async function renderCanonicalTaskTemplate(
  options: RenderCanonicalTaskOptions,
  defaultTemplatePath: string,
): Promise<string> {
  const rootDir = resolveRoot(options.rootDir);
  const templatePath = resolveFromRoot(
    rootDir,
    options.templatePath ?? defaultTemplatePath,
  );
  return renderTempljsTemplate(await fs.readFile(templatePath, "utf8"), {
    ...options.task,
    task: options.task,
  });
}

export function stableTaskJson(task: CanonicalTaskModel): string {
  return `${JSON.stringify(task, null, 2)}\n`;
}

export async function renderHumanTask(
  options: RenderCanonicalTaskOptions,
): Promise<string> {
  return renderCanonicalTaskTemplate(options, HUMAN_TEMPLATE_PATH);
}

export async function renderSandcastlePrompt(
  options: RenderCanonicalTaskOptions,
): Promise<string> {
  return renderCanonicalTaskTemplate(options, SANDCASTLE_TEMPLATE_PATH);
}
