import matter from "gray-matter";
import yaml from "js-yaml";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { SubjectResolverName } from "../backlog/scan-types.js";

export type LinkKind = "pr" | "evidence" | "reference";
export type ForgeProvider = "github" | "gitlab" | "bitbucket" | "subversion";

type Frontmatter = Record<string, unknown>;

interface MarkdownDocument {
  filePath: string;
  frontmatter: Frontmatter;
  body: string;
}

interface ConsumerRoots {
  backlog: string;
  active: string;
  archive: string;
  records: string;
  audit?: string;
}

interface ConsumerAutomation {
  autoCloseOnMerge?: boolean;
  autoEvidenceFromWorkflowRuns?: boolean;
  preserveCommitMap?: boolean;
  subjectResolutionOrder?: SubjectResolverName[];
  validateArchiveCandidates?: boolean;
  invalidCandidateStatus?: string;
}

interface ConsumerMigration {
  legacyActive?: string;
  legacyArchive?: string;
}

interface ResolvedConsumerConfig {
  roots: ConsumerRoots;
  automation: Required<
    Omit<
      ConsumerAutomation,
      "subjectResolutionOrder" | "invalidCandidateStatus"
    >
  > &
    Pick<
      ConsumerAutomation,
      "subjectResolutionOrder" | "invalidCandidateStatus"
    >;
  migration: Required<ConsumerMigration>;
}

export interface ConsumerConfig {
  roots?: Partial<ConsumerRoots>;
  automation?: ConsumerAutomation;
  migration?: ConsumerMigration;
}

export interface TransitionWorkItemOptions {
  rootDir?: string;
  consumerConfig?: string;
  id: string;
  status: string;
  statusReason?: string;
  actual?: number;
  assignee?: string;
  completedDate?: string;
  dryRun?: boolean;
}

export interface LinkWorkItemOptions {
  rootDir?: string;
  consumerConfig?: string;
  id: string;
  kind: LinkKind;
  value: string;
  dryRun?: boolean;
}

export interface RecordCommitOptions {
  rootDir?: string;
  consumerConfig?: string;
  id: string;
  sha: string;
  summary: string;
  dryRun?: boolean;
}

export interface CreateRecordOptions {
  rootDir?: string;
  consumerConfig?: string;
  id?: string;
  summary: string;
  subtype?: string;
  status?: string;
  statusReason?: string;
  outcome?: string;
  recordedAt?: string;
  observation: string;
  findings?: string[];
  notes?: string[];
  subjects: string[];
  artifactRefs?: string[];
  supportingRefs?: string[];
  dryRun?: boolean;
}

export interface FinalizeWorkItemOptions {
  rootDir?: string;
  consumerConfig?: string;
  id: string;
  statusReason?: string;
  completedDate?: string;
  actual?: number;
  dryRun?: boolean;
}

export interface MigrateBacklogOptions {
  rootDir?: string;
  consumerConfig?: string;
  dir?: string;
  dryRun?: boolean;
}

export interface IngestEventOptions {
  rootDir?: string;
  consumerConfig?: string;
  provider: ForgeProvider;
  event: string;
  payloadPath: string;
  dryRun?: boolean;
}

export interface TransitionWorkItemResult {
  id: string;
  filePath: string;
  frontmatter: Frontmatter;
  dryRun: boolean;
}

export interface LinkWorkItemResult extends TransitionWorkItemResult {
  kind: LinkKind;
  value: string;
}

export interface RecordCommitResult extends TransitionWorkItemResult {
  sha: string;
}

export interface CreateRecordResult {
  id: string;
  filePath: string;
  frontmatter: Frontmatter;
  body: string;
  dryRun: boolean;
}

export interface FinalizeWorkItemResult extends TransitionWorkItemResult {
  archivePath: string;
}

export interface MigrationRecord {
  legacyPath: string;
  newPath: string;
  legacyId: string | null;
  newId: string;
  generatedRecords: string[];
}

export interface MigrateBacklogResult {
  dryRun: boolean;
  migrated: MigrationRecord[];
  basenameMap: Record<string, string>;
}

export interface IngestEventResult {
  provider: ForgeProvider;
  event: string;
  dryRun: boolean;
  subjects: string[];
  actions: Array<Record<string, unknown>>;
}

const DEFAULT_ROOTS: ConsumerRoots = {
  backlog: "backlog",
  active: "backlog/active",
  archive: "backlog/archive",
  records: "backlog/records",
  audit: "backlog/audit",
};

const FRONTMATTER_ORDER = [
  "$schema",
  "$template",
  "id",
  "title",
  "summary",
  "owner",
  "assignee",
  "type",
  "subtype",
  "lifecycle",
  "status",
  "status_reason",
  "priority",
  "estimated",
  "actual",
  "completed_date",
  "commits",
  "links",
  "tags",
] as const;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function stripMarkdownExtension(value: string): string {
  return value.replace(/\.md$/i, "");
}

function ensureArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function inferStatusReason(status: string): string {
  switch (status) {
    case "proposed":
      return "needs-triage";
    case "ready":
      return "prioritized";
    case "in-progress":
      return "implementation";
    case "ready-for-review":
      return "awaiting-review";
    case "closed":
      return "completed";
    default:
      return "recorded";
  }
}

function inferLifecycle(status: string, archived: boolean): string {
  if (archived || status === "closed") {
    return "inactive";
  }
  if (status === "proposed") {
    return "draft";
  }
  return "active";
}

function normalizeStatus(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "ready";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "inprogress") {
    return "in-progress";
  }
  return normalized;
}

function normalizeSha(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeOptionalAssignee(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeLegacyCommitMap(
  value: unknown,
): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const normalizedEntries = Object.entries(
    value as Record<string, unknown>,
  ).reduce<Array<readonly [string, string]>>((entries, [sha, summary]) => {
    if (!/^[0-9a-f]{7,40}$/i.test(sha.trim())) {
      return entries;
    }
    if (typeof summary !== "string") {
      return entries;
    }
    const trimmedSummary = summary.trim();
    if (trimmedSummary.length === 0) {
      return entries;
    }
    entries.push([normalizeSha(sha), trimmedSummary] as const);
    return entries;
  }, []);

  if (normalizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(normalizedEntries);
}

function normalizeLink(kind: LinkKind, value: string): string {
  const trimmed = value.trim();
  if (kind === "pr") {
    return trimmed;
  }
  if (/^\[\[[^\]]+\]\]$/.test(trimmed)) {
    return trimmed;
  }
  if (/^(https?:)?\/\//.test(trimmed) || /^mailto:/.test(trimmed)) {
    return trimmed;
  }
  const basename = stripMarkdownExtension(
    trimmed.split(/[\\/]/).pop() || trimmed,
  );
  return `[[${basename}]]`;
}

function reorderFrontmatter(frontmatter: Frontmatter): Frontmatter {
  const ordered: Frontmatter = {};
  for (const key of FRONTMATTER_ORDER) {
    if (key in frontmatter) {
      ordered[key] = frontmatter[key];
    }
  }
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!(key in ordered)) {
      ordered[key] = value;
    }
  }
  return ordered;
}

function stringifyMarkdown(frontmatter: Frontmatter, body: string): string {
  const serialized = yaml.dump(reorderFrontmatter(frontmatter), {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });

  return `---\n${serialized}---\n\n${body.replace(/^\s+/, "")}`;
}

async function readMarkdown(filePath: string): Promise<MarkdownDocument> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = matter(raw);
  return {
    filePath,
    frontmatter: (parsed.data ?? {}) as Frontmatter,
    body: parsed.content,
  };
}

async function writeMarkdown(
  filePath: string,
  frontmatter: Frontmatter,
  body: string,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, stringifyMarkdown(frontmatter, body), "utf8");
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
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

export async function loadConsumerConfig(
  rootDir: string,
  configPath?: string,
): Promise<ResolvedConsumerConfig> {
  const fallback: ResolvedConsumerConfig = {
    roots: { ...DEFAULT_ROOTS },
    automation: {
      autoCloseOnMerge: false,
      autoEvidenceFromWorkflowRuns: true,
      preserveCommitMap: true,
      validateArchiveCandidates: false,
      subjectResolutionOrder: undefined,
      invalidCandidateStatus: undefined,
    },
    migration: {
      legacyActive: DEFAULT_ROOTS.backlog,
      legacyArchive: DEFAULT_ROOTS.archive,
    },
  };

  if (!configPath) {
    return fallback;
  }

  const loaded = await readJsonFile<ConsumerConfig>(
    path.resolve(rootDir, configPath),
  ).catch((err: unknown) => {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  });

  if (loaded === null) {
    return fallback;
  }
  return {
    roots: {
      ...fallback.roots,
      ...(loaded.roots ?? {}),
    },
    automation: {
      ...fallback.automation,
      ...(loaded.automation ?? {}),
    },
    migration: {
      ...fallback.migration,
      ...(loaded.migration ?? {}),
    },
  };
}

function ensureWorkItemLinks(
  frontmatter: Frontmatter,
): Record<string, unknown> {
  const links =
    typeof frontmatter.links === "object" && frontmatter.links !== null
      ? { ...(frontmatter.links as Record<string, unknown>) }
      : {};
  frontmatter.links = links;
  return links;
}

async function resolveWorkItemFile(
  rootDir: string,
  config: ResolvedConsumerConfig,
  id: string,
): Promise<string> {
  const dirs = [config.roots.active, config.roots.archive].map((value) =>
    path.resolve(rootDir, value),
  );
  for (const dirPath of dirs) {
    const files = await findMarkdownFiles(dirPath);
    for (const filePath of files) {
      const document = await readMarkdown(filePath);
      if (document.frontmatter.id === id) {
        return filePath;
      }
    }
  }
  throw new Error(`Unable to find work item '${id}'.`);
}

function buildWorkItemBasename(slug: string): string {
  return `work-item-${slug}`;
}

function buildWorkItemId(slug: string): string {
  return `work-item:${slug}`;
}

function buildRecordBasename(slug: string): string {
  return `record-${slug}`;
}

function buildRecordId(slug: string): string {
  return `record:${slug}`;
}

function deriveLegacySlug(filePath: string): string {
  return slugify(path.basename(filePath, ".md").replace(/_/g, "-"));
}

function summarizeLegacyItem(
  frontmatter: Frontmatter,
  filePath: string,
): string {
  const summary =
    typeof frontmatter.summary === "string" ? frontmatter.summary.trim() : "";
  if (summary.length > 0) {
    return summary;
  }
  const title =
    typeof frontmatter.title === "string" ? frontmatter.title.trim() : "";
  if (title.length > 0) {
    return title.replace(/^\d+:\s*/, "");
  }
  return deriveLegacySlug(filePath).replace(/-/g, " ");
}

function extractLegacyDependencies(frontmatter: Frontmatter): string[] {
  const links =
    typeof frontmatter.links === "object" && frontmatter.links !== null
      ? (frontmatter.links as Record<string, unknown>)
      : {};
  return ensureArray(links.depends_on);
}

function extractLegacyPullRequests(frontmatter: Frontmatter): string[] {
  const links =
    typeof frontmatter.links === "object" && frontmatter.links !== null
      ? (frontmatter.links as Record<string, unknown>)
      : {};
  return ensureArray(links.pull_requests);
}

function extractLegacyTestResults(
  frontmatter: Frontmatter,
): Array<{ timestamp?: string; note: string }> {
  if (!Array.isArray(frontmatter.test_results)) {
    return [];
  }

  return frontmatter.test_results
    .filter(
      (entry): entry is { timestamp?: string; note?: string } =>
        typeof entry === "object" && entry !== null,
    )
    .map((entry) => ({
      timestamp:
        typeof entry.timestamp === "string" ? entry.timestamp : undefined,
      note: typeof entry.note === "string" ? entry.note : "",
    }))
    .filter((entry) => entry.note.trim().length > 0);
}

function rewriteBasenames(
  content: string,
  basenameMap: Record<string, string>,
): string {
  return content.replace(
    /\[\[([^\]|#]+)([^\]]*)\]\]/g,
    (fullMatch, target, suffix) => {
      const normalizedTarget = stripMarkdownExtension(String(target).trim());
      const replacement = basenameMap[normalizedTarget];
      if (!replacement) {
        return fullMatch;
      }
      return `[[${replacement}${suffix}]]`;
    },
  );
}

function appendRelationships(body: string, dependencies: string[]): string {
  if (dependencies.length === 0) {
    return body;
  }
  const lines = dependencies.map(
    (dependency) => `- \`depends_on\`: ${dependency}`,
  );
  const trimmed = body.replace(/\s+$/, "");
  return `${trimmed}\n\n## Relationships\n\n${lines.join("\n")}\n`;
}

function buildRecordBody(options: CreateRecordOptions): string {
  const findings = unique(options.findings ?? []);
  const notes = unique(options.notes ?? []);
  const artifacts = unique(options.artifactRefs ?? []);
  const subjects = unique(options.subjects ?? []);
  const supportingRefs = unique(options.supportingRefs ?? []);

  const lines: string[] = [
    "## Recorded At",
    "",
    options.recordedAt ?? new Date().toISOString(),
    "",
    "## Outcome",
    "",
    options.outcome ?? "noted",
    "",
    "## Observation",
    "",
    options.observation.trim(),
    "",
    "## Subject References",
    "",
    ...subjects.map((subject) => `- ${subject}`),
  ];

  if (findings.length > 0) {
    lines.push(
      "",
      "## Findings",
      "",
      ...findings.map((finding) => `- ${finding}`),
    );
  }
  if (artifacts.length > 0) {
    lines.push(
      "",
      "## Artifact References",
      "",
      ...artifacts.map((artifact) => `- ${artifact}`),
    );
  }
  if (supportingRefs.length > 0) {
    lines.push(
      "",
      "## Supporting References",
      "",
      ...supportingRefs.map((reference) => `- ${reference}`),
    );
  }
  if (notes.length > 0) {
    lines.push("", "## Notes", "", ...notes.map((note) => `- ${note}`));
  }

  return `${lines.join("\n")}\n`;
}

async function createRecordInternal(
  rootDir: string,
  config: ResolvedConsumerConfig,
  options: CreateRecordOptions,
): Promise<CreateRecordResult> {
  const subtype = options.subtype ?? "test-result";
  if (
    options.id &&
    !/^record:[a-zA-Z0-9]+(?:[_-][a-zA-Z0-9]+)*$/.test(options.id)
  ) {
    throw new Error(
      `Invalid record id '${options.id}': must match record:<slug> with alphanumeric segments separated by dashes or underscores`,
    );
  }
  const slug = options.id
    ? options.id.replace(/^record:/, "")
    : slugify(options.summary);
  const recordId = options.id ?? buildRecordId(slug);
  const recordsRoot = path.resolve(rootDir, config.roots.records);
  const filePath = path.resolve(recordsRoot, `${buildRecordBasename(slug)}.md`);
  if (!filePath.startsWith(`${recordsRoot}${path.sep}`)) {
    throw new Error(
      `Resolved record path escapes records root for '${recordId}'`,
    );
  }
  const supportingRefs = unique(
    (options.supportingRefs ?? []).map((value) =>
      normalizeLink("reference", value),
    ),
  );

  const frontmatter: Frontmatter = {
    $schema: "schemas/work-management/frontmatter/record.json",
    id: recordId,
    title: options.summary.trim(),
    summary: options.summary.trim(),
    type: "record",
    subtype,
    lifecycle: "active",
    status: options.status ?? "ready",
    status_reason: options.statusReason ?? "recorded",
  };

  if (supportingRefs.length > 0) {
    frontmatter.links = { supporting_reference: supportingRefs };
  }

  const body = buildRecordBody({ ...options, id: recordId, supportingRefs });
  if (!options.dryRun) {
    await writeMarkdown(filePath, frontmatter, body);
  }

  return {
    id: recordId,
    filePath,
    frontmatter,
    body,
    dryRun: Boolean(options.dryRun),
  };
}

export async function transitionWorkItem(
  options: TransitionWorkItemOptions,
): Promise<TransitionWorkItemResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const filePath = await resolveWorkItemFile(rootDir, config, options.id);
  const document = await readMarkdown(filePath);
  const status = normalizeStatus(options.status);

  document.frontmatter.status = status;
  document.frontmatter.status_reason =
    options.statusReason ?? inferStatusReason(status);
  if (typeof options.actual === "number") {
    document.frontmatter.actual = options.actual;
  }
  if (typeof options.assignee === "string") {
    const normalizedAssignee = normalizeOptionalAssignee(options.assignee);
    if (normalizedAssignee) {
      document.frontmatter.assignee = normalizedAssignee;
    } else {
      delete document.frontmatter.assignee;
    }
  }
  if (typeof options.completedDate === "string") {
    document.frontmatter.completed_date = options.completedDate;
  }
  if (status === "closed") {
    document.frontmatter.lifecycle = "inactive";
    document.frontmatter.completed_date ??= new Date()
      .toISOString()
      .slice(0, 10);
  }

  if (!options.dryRun) {
    await writeMarkdown(filePath, document.frontmatter, document.body);
  }

  return {
    id: options.id,
    filePath,
    frontmatter: document.frontmatter,
    dryRun: Boolean(options.dryRun),
  };
}

export async function linkWorkItem(
  options: LinkWorkItemOptions,
): Promise<LinkWorkItemResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const filePath = await resolveWorkItemFile(rootDir, config, options.id);
  const document = await readMarkdown(filePath);
  const links = ensureWorkItemLinks(document.frontmatter);
  const bucketKey = options.kind === "pr" ? "pull_requests" : options.kind;
  const normalizedValue = normalizeLink(options.kind, options.value);
  links[bucketKey] = unique([
    ...ensureArray(links[bucketKey]),
    normalizedValue,
  ]);

  if (!options.dryRun) {
    await writeMarkdown(filePath, document.frontmatter, document.body);
  }

  return {
    id: options.id,
    filePath,
    frontmatter: document.frontmatter,
    kind: options.kind,
    value: normalizedValue,
    dryRun: Boolean(options.dryRun),
  };
}

export async function recordWorkItemCommit(
  options: RecordCommitOptions,
): Promise<RecordCommitResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const filePath = await resolveWorkItemFile(rootDir, config, options.id);
  const document = await readMarkdown(filePath);
  const commits =
    typeof document.frontmatter.commits === "object" &&
    document.frontmatter.commits !== null
      ? { ...(document.frontmatter.commits as Record<string, unknown>) }
      : {};

  if (!/^[0-9a-f]{7,40}$/i.test(options.sha.trim())) {
    throw new Error(
      `Invalid commit SHA "${options.sha}": must be a hex string of 7–40 characters`,
    );
  }
  const trimmedSummary = options.summary.trim();
  if (trimmedSummary.length === 0) {
    throw new Error("Commit summary must not be empty");
  }
  commits[normalizeSha(options.sha)] = trimmedSummary;
  document.frontmatter.commits = commits;

  if (!options.dryRun) {
    await writeMarkdown(filePath, document.frontmatter, document.body);
  }

  return {
    id: options.id,
    filePath,
    frontmatter: document.frontmatter,
    sha: normalizeSha(options.sha),
    dryRun: Boolean(options.dryRun),
  };
}

export async function createRecord(
  options: CreateRecordOptions,
): Promise<CreateRecordResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  return createRecordInternal(rootDir, config, options);
}

export async function finalizeWorkItem(
  options: FinalizeWorkItemOptions,
): Promise<FinalizeWorkItemResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const filePath = await resolveWorkItemFile(rootDir, config, options.id);
  const document = await readMarkdown(filePath);
  const links =
    typeof document.frontmatter.links === "object" &&
    document.frontmatter.links !== null
      ? (document.frontmatter.links as Record<string, unknown>)
      : {};

  if (ensureArray(links.pull_requests).length === 0) {
    throw new Error(`Cannot finalize '${options.id}' without linked PRs.`);
  }
  if (ensureArray(links.evidence).length === 0) {
    throw new Error(`Cannot finalize '${options.id}' without linked evidence.`);
  }

  document.frontmatter.status = "closed";
  document.frontmatter.status_reason = options.statusReason ?? "completed";
  document.frontmatter.lifecycle = "inactive";
  document.frontmatter.completed_date =
    options.completedDate ?? new Date().toISOString().slice(0, 10);
  if (typeof options.actual === "number") {
    document.frontmatter.actual = options.actual;
  }
  if (typeof document.frontmatter.actual !== "number") {
    throw new Error(
      `Cannot finalize '${options.id}' without actual effort recorded.`,
    );
  }

  const archivePath = path.resolve(
    rootDir,
    config.roots.archive,
    path.basename(filePath),
  );
  if (!options.dryRun) {
    await writeMarkdown(archivePath, document.frontmatter, document.body);
    if (path.resolve(filePath) !== archivePath) {
      await fs.unlink(filePath);
    }
  }

  return {
    id: options.id,
    filePath,
    archivePath,
    frontmatter: document.frontmatter,
    dryRun: Boolean(options.dryRun),
  };
}

export async function migrateBacklog(
  options: MigrateBacklogOptions,
): Promise<MigrateBacklogResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const legacyRoot = path.resolve(
    rootDir,
    options.dir ?? config.migration.legacyActive,
  );
  const legacyArchive = path.resolve(rootDir, config.migration.legacyArchive);
  const activeFiles = (await findMarkdownFiles(legacyRoot)).filter(
    (filePath) =>
      !filePath.includes(`${path.sep}archive${path.sep}`) &&
      path.basename(filePath) !== "AGENTS.md",
  );
  const archiveFiles = (await findMarkdownFiles(legacyArchive)).filter(
    (filePath) => path.basename(filePath) !== "AGENTS.md",
  );
  const files = unique([...activeFiles, ...archiveFiles]);
  const basenameMap: Record<string, string> = {};
  const targetBasenameSet = new Set<string>();
  const skippedLegacyPaths = new Set<string>();

  for (const legacyPath of files) {
    const slug = deriveLegacySlug(legacyPath);
    const legacyBasename = stripMarkdownExtension(path.basename(legacyPath));
    const targetBasename = buildWorkItemBasename(slug);
    if (targetBasenameSet.has(targetBasename)) {
      console.warn(
        `[migrateBacklog] Skipping "${legacyPath}": target basename "${targetBasename}" is already mapped by another entry`,
      );
      skippedLegacyPaths.add(legacyPath);
      continue;
    }
    targetBasenameSet.add(targetBasename);
    basenameMap[legacyBasename] = targetBasename;
  }

  const migrated: MigrationRecord[] = [];

  for (const legacyPath of files) {
    if (skippedLegacyPaths.has(legacyPath)) {
      continue;
    }

    const isArchived = legacyPath.startsWith(legacyArchive);
    const legacyDoc = await readMarkdown(legacyPath);
    const slug = deriveLegacySlug(legacyPath);
    const newId = buildWorkItemId(slug);
    const newBasename = buildWorkItemBasename(slug);
    const normalizedStatus = isArchived
      ? "closed"
      : normalizeStatus(legacyDoc.frontmatter.status);
    const pullRequests = unique(
      extractLegacyPullRequests(legacyDoc.frontmatter),
    );
    const dependencies = extractLegacyDependencies(legacyDoc.frontmatter)
      .map((dependency) => dependency.replace(/^\[\[|\]\]$/g, ""))
      .map(
        (dependency) =>
          basenameMap[stripMarkdownExtension(dependency)] ?? dependency,
      )
      .map((dependency) => `[[${stripMarkdownExtension(dependency)}]]`);

    const assignee = normalizeOptionalAssignee(legacyDoc.frontmatter.assignee);
    const normalizedCommits = normalizeLegacyCommitMap(
      legacyDoc.frontmatter.commits,
    );

    const frontmatter: Frontmatter = {
      $schema: "schemas/work-management/frontmatter/work-item.json",
      id: newId,
      title: legacyDoc.frontmatter.title,
      summary: summarizeLegacyItem(legacyDoc.frontmatter, legacyPath),
      type: "work-item",
      subtype: legacyDoc.frontmatter.subtype ?? "task",
      lifecycle: inferLifecycle(normalizedStatus, isArchived),
      status: normalizedStatus,
      status_reason:
        typeof legacyDoc.frontmatter.status_reason === "string"
          ? legacyDoc.frontmatter.status_reason
          : inferStatusReason(normalizedStatus),
      priority: legacyDoc.frontmatter.priority ?? "medium",
      estimated:
        typeof legacyDoc.frontmatter.estimated === "number"
          ? legacyDoc.frontmatter.estimated
          : 0,
    };

    if (typeof legacyDoc.frontmatter.owner === "string") {
      frontmatter.owner = legacyDoc.frontmatter.owner;
    }
    if (assignee) {
      frontmatter.assignee = assignee;
    }
    if (Array.isArray(legacyDoc.frontmatter.tags)) {
      frontmatter.tags = legacyDoc.frontmatter.tags;
    }
    if (typeof legacyDoc.frontmatter.actual === "number") {
      frontmatter.actual = legacyDoc.frontmatter.actual;
    } else if (normalizedStatus === "closed") {
      frontmatter.actual =
        typeof legacyDoc.frontmatter.estimated === "number"
          ? legacyDoc.frontmatter.estimated
          : 0;
    }
    if (typeof legacyDoc.frontmatter.completed_date === "string") {
      frontmatter.completed_date = legacyDoc.frontmatter.completed_date;
    }
    if (normalizedCommits) {
      frontmatter.commits = normalizedCommits;
    }

    const links: Record<string, unknown> = {};
    if (pullRequests.length > 0) {
      links.pull_requests = pullRequests;
    }

    const generatedRecords: string[] = [];
    const legacyTestResults = extractLegacyTestResults(legacyDoc.frontmatter);
    const fallbackEvidence =
      legacyTestResults.length === 0 && normalizedStatus === "closed";
    const evidenceEntries = fallbackEvidence
      ? [
          {
            timestamp:
              typeof legacyDoc.frontmatter.completed_date === "string"
                ? `${legacyDoc.frontmatter.completed_date}T00:00:00Z`
                : undefined,
            note: "Legacy closed work item migrated without inline test_results; preserved as closure evidence.",
          },
        ]
      : legacyTestResults;

    for (let index = 0; index < evidenceEntries.length; index += 1) {
      const entry = evidenceEntries[index];
      const recordSlug = `${slug}-evidence-${index + 1}`;
      const record = await createRecordInternal(rootDir, config, {
        id: buildRecordId(recordSlug),
        summary: `${String(
          frontmatter.title ?? frontmatter.summary,
        )} evidence ${index + 1}`,
        subtype: legacyTestResults.length === 0 ? "evidence" : "test-result",
        status: "ready",
        statusReason: "recorded",
        outcome: legacyTestResults.length === 0 ? "noted" : "noted",
        recordedAt: entry.timestamp,
        observation: entry.note,
        subjects: [`[[${newBasename}]]`],
        artifactRefs: pullRequests,
        dryRun: options.dryRun,
      });
      generatedRecords.push(path.basename(record.filePath));
    }

    if (generatedRecords.length > 0) {
      links.evidence = generatedRecords.map(
        (recordFile) => `[[${stripMarkdownExtension(recordFile)}]]`,
      );
    }
    if (Object.keys(links).length > 0) {
      frontmatter.links = links;
    }

    const rewrittenBody = appendRelationships(
      rewriteBasenames(legacyDoc.body, basenameMap),
      dependencies,
    );
    const targetPath = path.resolve(
      rootDir,
      isArchived ? config.roots.archive : config.roots.active,
      `${newBasename}.md`,
    );

    if (!options.dryRun) {
      await writeMarkdown(targetPath, frontmatter, rewrittenBody);
      if (path.resolve(legacyPath) !== targetPath) {
        await fs.unlink(legacyPath);
      }
    }

    migrated.push({
      legacyPath,
      newPath: targetPath,
      legacyId:
        typeof legacyDoc.frontmatter.id === "string"
          ? legacyDoc.frontmatter.id
          : null,
      newId,
      generatedRecords,
    });
  }

  if (!options.dryRun && config.roots.audit) {
    const mappingPath = path.resolve(
      rootDir,
      config.roots.audit,
      "work-management-migration-map.json",
    );
    await fs.mkdir(path.dirname(mappingPath), { recursive: true });
    await fs.writeFile(
      mappingPath,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), migrated, basenameMap },
        null,
        2,
      ),
      "utf8",
    );
  }

  return { dryRun: Boolean(options.dryRun), migrated, basenameMap };
}

function extractGithubSubjects(payload: Record<string, unknown>): string[] {
  const subjects = new Set<string>();
  const maybeStrings = [
    payload.doc_vader_subjects,
    payload.docVaderSubjects,
    payload.body,
    (payload.pull_request as Record<string, unknown> | undefined)?.body,
    (payload.pull_request as Record<string, unknown> | undefined)?.title,
    (payload.workflow_run as Record<string, unknown> | undefined)
      ?.display_title,
    (payload.workflow_run as Record<string, unknown> | undefined)?.name,
  ];

  for (const value of maybeStrings) {
    if (typeof value !== "string") {
      continue;
    }
    const matches = value.match(/work-item:[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
    for (const match of matches) {
      subjects.add(match);
    }
  }

  return Array.from(subjects);
}

function githubWorkflowOutcome(conclusion: string | undefined): string {
  switch (conclusion) {
    case "success":
      return "pass";
    case "failure":
      return "fail";
    case "cancelled":
    case "timed_out":
      return "mixed";
    default:
      return "noted";
  }
}

export async function ingestEvent(
  options: IngestEventOptions,
): Promise<IngestEventResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const payload = await readJsonFile<Record<string, unknown>>(
    path.resolve(rootDir, options.payloadPath),
  );

  if (options.provider !== "github") {
    throw new Error(`Provider '${options.provider}' is not implemented yet.`);
  }

  const subjects = extractGithubSubjects(payload);
  const actions: Array<Record<string, unknown>> = [];

  if (options.event.startsWith("pull_request")) {
    const pullRequest =
      (payload.pull_request as Record<string, unknown> | undefined) ?? {};
    const prUrl =
      typeof pullRequest.html_url === "string"
        ? pullRequest.html_url
        : undefined;
    const merged = pullRequest.merged === true;
    const mergeCommitSha =
      typeof pullRequest.merge_commit_sha === "string"
        ? pullRequest.merge_commit_sha
        : undefined;
    const title =
      typeof pullRequest.title === "string"
        ? pullRequest.title
        : "Merged pull request";

    for (const subject of subjects) {
      if (prUrl) {
        await linkWorkItem({
          rootDir,
          consumerConfig: options.consumerConfig,
          id: subject,
          kind: "pr",
          value: prUrl,
          dryRun: options.dryRun,
        });
        actions.push({ type: "link", subject, kind: "pr", value: prUrl });
      }
      if (merged && mergeCommitSha) {
        await recordWorkItemCommit({
          rootDir,
          consumerConfig: options.consumerConfig,
          id: subject,
          sha: mergeCommitSha,
          summary: title,
          dryRun: options.dryRun,
        });
        actions.push({
          type: "record-commit",
          subject,
          sha: mergeCommitSha,
          summary: title,
        });
      }
      if (merged && config.automation.autoCloseOnMerge) {
        const workItemPath = await resolveWorkItemFile(
          rootDir,
          config,
          subject,
        );
        const workItem = await readMarkdown(workItemPath);
        const links =
          typeof workItem.frontmatter.links === "object" &&
          workItem.frontmatter.links !== null
            ? (workItem.frontmatter.links as Record<string, unknown>)
            : {};
        if (
          ensureArray(links.evidence).length > 0 &&
          typeof workItem.frontmatter.actual === "number"
        ) {
          await finalizeWorkItem({
            rootDir,
            consumerConfig: options.consumerConfig,
            id: subject,
            dryRun: options.dryRun,
          });
          actions.push({ type: "finalize", subject });
        }
      }
    }
  }

  if (
    options.event.startsWith("workflow_run") &&
    config.automation.autoEvidenceFromWorkflowRuns
  ) {
    const workflowRun =
      (payload.workflow_run as Record<string, unknown> | undefined) ?? {};
    const workflowName =
      typeof workflowRun.name === "string" ? workflowRun.name : "workflow";
    const conclusion =
      typeof workflowRun.conclusion === "string"
        ? workflowRun.conclusion
        : undefined;
    const htmlUrl =
      typeof workflowRun.html_url === "string"
        ? workflowRun.html_url
        : undefined;
    const runId =
      workflowRun.id !== undefined ? String(workflowRun.id) : workflowName;

    for (const subject of subjects) {
      const subjectSlug = subject.replace(/^work-item:/, "");
      const record = await createRecordInternal(rootDir, config, {
        id: buildRecordId(
          `${subjectSlug}-${slugify(workflowName)}-${slugify(runId)}`,
        ),
        summary: `${workflowName} result for ${subject}`,
        subtype: "test-result",
        status: "ready",
        statusReason: "recorded",
        outcome: githubWorkflowOutcome(conclusion),
        recordedAt:
          typeof workflowRun.updated_at === "string"
            ? workflowRun.updated_at
            : new Date().toISOString(),
        observation: `Workflow '${workflowName}' completed with conclusion '${
          conclusion ?? "unknown"
        }'.`,
        findings: htmlUrl ? [`Run details: ${htmlUrl}`] : undefined,
        subjects: [`[[work-item-${subjectSlug}]]`],
        artifactRefs: htmlUrl ? [htmlUrl] : undefined,
        dryRun: options.dryRun,
      });
      const evidenceLink = `[[${stripMarkdownExtension(
        path.basename(record.filePath),
      )}]]`;
      await linkWorkItem({
        rootDir,
        consumerConfig: options.consumerConfig,
        id: subject,
        kind: "evidence",
        value: evidenceLink,
        dryRun: options.dryRun,
      });
      actions.push({
        type: "create-record",
        subject,
        record: record.id,
        outcome: githubWorkflowOutcome(conclusion),
      });
      actions.push({
        type: "link",
        subject,
        kind: "evidence",
        value: evidenceLink,
      });
    }
  }

  return {
    provider: options.provider,
    event: options.event,
    dryRun: Boolean(options.dryRun),
    subjects,
    actions,
  };
}
