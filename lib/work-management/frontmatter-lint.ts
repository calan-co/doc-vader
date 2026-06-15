import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  dirname,
  isAbsolute,
  join,
  extname,
  normalize,
  relative,
  resolve,
} from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { Ajv as LegacyAjv } from "ajv";
import type { ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as formatsPluginModule from "ajv-formats";
import type { FormatsPlugin } from "ajv-formats";
import { fileURLToPath } from "node:url";
import { evaluateTransition as evaluateTransitionCore } from "./state-transition-evaluator.js";
import {
  compileTransitionProfile,
  resolveStateVector,
  type CompiledTransitionProfile,
} from "./transition-profile.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function findPackageRoot(startDir: string): string {
  let current = startDir;
  while (current !== dirname(current)) {
    if (
      existsSync(join(current, "package.json")) &&
      existsSync(join(current, "schemas"))
    ) {
      return current;
    }

    current = dirname(current);
  }

  return resolve(startDir, "..", "..");
}

const PACKAGE_ROOT = findPackageRoot(SCRIPT_DIR);
const SCHEMAS_ROOT = join(PACKAGE_ROOT, "schemas");
const SCHEMA_DIR = join(SCHEMAS_ROOT, "frontmatter");
const WORK_MANAGEMENT_SCHEMA_DIR = join(SCHEMAS_ROOT, "work-management");

interface SchemaMap {
  byType: Record<string, string>;
  support: {
    base: string;
    statusTransitionPayload: string;
  };
}

interface WorkItemRef {
  status: string;
  file: string;
  id: string;
  title: string;
}

type Severity = "error" | "warn" | "info";

interface FrontmatterDiagnostic {
  code: string;
  path: string;
  message: string;
  severity: Severity;
  semantic?: boolean;
}

interface StrictSeverityResult {
  severity: Severity;
  masked: boolean;
}

interface ConsumerSeverityConfig {
  roots?: {
    backlog?: string;
    archive?: string;
  };
  automation?: {
    prePushValidation?: {
      severity?: Record<string, string>;
    };
  };
}

interface AjvLike {
  addSchema: (schema: Record<string, unknown>) => AjvLike;
  getSchema: (keyRef: string) => ValidateFunction<unknown> | undefined;
  compile: (schema: Record<string, unknown>) => ValidateFunction<unknown>;
}

const addFormats = formatsPluginModule.default as unknown as FormatsPlugin;

function addSchemaIfMissing(
  ajv: AjvLike,
  schema: Record<string, unknown>,
): void {
  const schemaId = typeof schema.$id === "string" ? schema.$id : null;
  if (schemaId && ajv.getSchema(schemaId)) {
    return;
  }

  ajv.addSchema(schema);
}

function normalizeSeverity(value: unknown): Severity | null {
  return value === "error" || value === "warn" || value === "info"
    ? value
    : null;
}

function resolveConfiguredSeverity(
  diagnostic: FrontmatterDiagnostic,
  consumerConfig: ConsumerSeverityConfig,
): Severity | null {
  const severities = consumerConfig.automation?.prePushValidation?.severity;
  if (!severities) {
    return null;
  }

  const byCode = normalizeSeverity(severities[diagnostic.code]);
  if (byCode) {
    return byCode;
  }

  if (diagnostic.semantic) {
    const byCategory = normalizeSeverity(severities.semantic);
    if (byCategory) {
      return byCategory;
    }
  }

  return null;
}

export function applyStrictSeverity(
  diagnostic: FrontmatterDiagnostic,
  strictMode: boolean,
  consumerConfig: ConsumerSeverityConfig,
): StrictSeverityResult {
  const configuredSeverity = resolveConfiguredSeverity(
    diagnostic,
    consumerConfig,
  );

  if (diagnostic.severity === "error") {
    return { severity: "error", masked: false };
  }

  const effectiveSeverity = configuredSeverity ?? diagnostic.severity;

  if (
    strictMode &&
    diagnostic.semantic === true &&
    diagnostic.severity === "warn"
  ) {
    if (configuredSeverity === "warn" || configuredSeverity === "info") {
      return { severity: effectiveSeverity, masked: true };
    }

    return { severity: "error", masked: false };
  }

  return { severity: effectiveSeverity, masked: false };
}

type TransitionContractLike = Parameters<typeof evaluateTransitionCore>[2];

let cachedDefaultTransitionProfile: CompiledTransitionProfile | undefined;

function isTransitionContractLike(
  contract: unknown,
): contract is TransitionContractLike {
  return (
    !!contract &&
    typeof contract === "object" &&
    Array.isArray((contract as { precedence?: unknown }).precedence) &&
    Array.isArray((contract as { rules?: unknown }).rules)
  );
}

function getDefaultTransitionProfile(): CompiledTransitionProfile {
  if (!cachedDefaultTransitionProfile) {
    cachedDefaultTransitionProfile = loadSchemas().transitionProfile;
  }

  return cachedDefaultTransitionProfile;
}

function normalizeDefaultTransitionInput(
  value: Parameters<typeof evaluateTransitionCore>[0],
): Parameters<typeof evaluateTransitionCore>[0] {
  if (!value || typeof value !== "object") {
    return value;
  }

  const snapshot = { ...(value as Record<string, unknown>) };
  if (
    typeof snapshot.reason === "string" &&
    snapshot.status_reason === undefined
  ) {
    snapshot.status_reason = snapshot.reason;
  }

  return snapshot as Parameters<typeof evaluateTransitionCore>[0];
}

export function evaluateTransition(
  previous: Parameters<typeof evaluateTransitionCore>[0],
  current: Parameters<typeof evaluateTransitionCore>[1],
  contract?: unknown,
): ReturnType<typeof evaluateTransitionCore> {
  if (!isTransitionContractLike(contract)) {
    const profile = getDefaultTransitionProfile();
    return evaluateTransitionCore(
      resolveStateVector(profile, normalizeDefaultTransitionInput(previous)),
      resolveStateVector(profile, normalizeDefaultTransitionInput(current)),
      profile.transitions,
    );
  }

  return evaluateTransitionCore(previous, current, contract);
}

/**
 * Parse YAML frontmatter from markdown file
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseFrontmatter(content: string): Record<string, any> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    throw new Error("No YAML frontmatter found");
  }

  return (yaml.load(match[1]) ?? {}) as Record<string, unknown>;
}

function parseJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function isWithinPath(child: string, parent: string): boolean {
  const relativePath = relative(resolve(parent), resolve(child));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function loadConsumerSeverityConfig(): ConsumerSeverityConfig {
  const consumerConfigPath = join(
    process.cwd(),
    ".doc-vader",
    "backlog-consumer.json",
  );
  if (!existsSync(consumerConfigPath)) {
    return {};
  }

  try {
    return parseJsonFile<ConsumerSeverityConfig>(consumerConfigPath);
  } catch (error) {
    throw new Error(
      `Failed to parse consumer severity config at '${consumerConfigPath}': ${
        (error as Error).message
      }`,
      { cause: error },
    );
  }
}

function parseCliArgs(argv: string[]): { strict: boolean; fileArgs: string[] } {
  const fileArgs: string[] = [];
  let strict = false;

  for (const arg of argv) {
    if (arg === "--strict") {
      strict = true;
      continue;
    }

    fileArgs.push(arg);
  }

  return { strict, fileArgs };
}

function resolveSchemaPath(schemaPath: string): string {
  const normalized = schemaPath.replace(/^\.\/+/, "");
  if (/^https?:\/\//i.test(normalized)) {
    const pathname = new URL(normalized).pathname;
    const schemaIndex = pathname.indexOf("/schemas/");
    const schemaRelative = schemaIndex >= 0 ? pathname.slice(schemaIndex + "/schemas/".length) : pathname.replace(/^\/+/, "");
    const localPath = join(SCHEMAS_ROOT, schemaRelative);
    return localPath.endsWith(".json") ? localPath : `${localPath}.json`;
  }

  const schemaRelative = normalized.replace(/^schemas\//, "");
  const rootCandidate = join(SCHEMAS_ROOT, schemaRelative);
  if (existsSync(rootCandidate)) {
    return rootCandidate;
  }

  if (!rootCandidate.endsWith(".json") && existsSync(`${rootCandidate}.json`)) {
    return `${rootCandidate}.json`;
  }

  const workspaceCandidate = join(process.cwd(), normalized);
  if (existsSync(workspaceCandidate)) {
    return workspaceCandidate;
  }

  if (!workspaceCandidate.endsWith(".json") && existsSync(`${workspaceCandidate}.json`)) {
    return `${workspaceCandidate}.json`;
  }

  const fallback = join(SCHEMA_DIR, schemaRelative);
  return fallback.endsWith(".json") ? fallback : `${fallback}.json`;
}

function collectSchemaFiles(dirPath: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSchemaFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }

  return files;
}

function extractCanonicalRelationshipDependencies(content: string): string[] {
  const sectionMatch = content.match(
    /^## Relationships\s*\n([\s\S]*?)(?=^##\s|$)/m,
  );
  if (!sectionMatch) {
    return [];
  }

  const refs: string[] = [];
  const wikilinkRegex = /\[\[([^\]]+)\]\]/g;

  for (const match of sectionMatch[1].matchAll(wikilinkRegex)) {
    const canonicalRef = match[1].split("|", 1)[0].trim();
    if (canonicalRef) {
      refs.push(canonicalRef);
    }
  }

  return refs;
}

function extractWikilinkTarget(reference: string): string | null {
  const match = reference.match(/^\[\[([^\]]+)\]\]$/);
  if (!match) {
    return null;
  }

  const target = match[1].split("|", 1)[0].trim();
  return target.length > 0 ? target : null;
}

/**
 * Return unchecked checklist item labels from a named second-level markdown section.
 */
function extractUncheckedChecklistItemsFromSection(
  content: string,
  heading: string,
): string[] {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionRegex = new RegExp(
    `(?:^|\\n)##\\s+${escapedHeading}(?:\\b[^\\n]*)?\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
  );
  const sectionMatch = content.match(sectionRegex);
  if (!sectionMatch) {
    return [];
  }

  const sectionBody = sectionMatch[1];
  const uncheckedItems: string[] = [];
  const uncheckedRegex = /^\s*-\s*\[\s\]\s+(.*)$/gm;
  for (const match of sectionBody.matchAll(uncheckedRegex)) {
    const item = match[1]?.trim();
    if (item) {
      uncheckedItems.push(item);
    }
  }

  return uncheckedItems;
}

function collectBacklogMarkdownFiles(
  dirPath: string,
  relativePrefix = "",
): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = join(dirPath, entry.name);
    const relativePath = relativePrefix
      ? `${relativePrefix}/${entry.name}`
      : entry.name;

    if (entry.isDirectory()) {
      files.push(...collectBacklogMarkdownFiles(fullPath, relativePath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(toPosixPath(relativePath));
    }
  }

  return files.sort();
}

/**
 * Load and compile JSON schemas with Ajv
 */
function loadSchemas() {
  const ajv = new LegacyAjv({
    schemas: [],
    strict: false,
    allErrors: true,
    verbose: true,
    validateSchema: false, // Skip meta-schema validation (we trust our schemas)
  });

  const workManagementAjv = new Ajv2020({
    schemas: [],
    strict: false,
    allErrors: true,
    verbose: true,
    validateSchema: false,
  });

  addFormats(ajv);
  addFormats(workManagementAjv);

  const schemaMapPath = join(SCHEMA_DIR, "schema-map.json");
  const schemaMap = parseJsonFile<SchemaMap>(schemaMapPath);
  const supportedTypes = Object.keys(schemaMap.byType).sort();
  const schemaFiles = [
    ...collectSchemaFiles(SCHEMA_DIR),
    ...collectSchemaFiles(WORK_MANAGEMENT_SCHEMA_DIR),
  ].sort();
  const workManagementSchemas: Record<string, unknown>[] = [];

  for (const schemaFile of schemaFiles) {
    const relativePath = toPosixPath(relative(SCHEMA_DIR, schemaFile));
    if (
      relativePath === "schema-map.json" ||
      relativePath.endsWith("/latest.json") ||
      relativePath.startsWith("by-type/")
    ) {
      continue;
    }

    const schema = parseJsonFile<Record<string, unknown>>(schemaFile);
    addSchemaIfMissing(ajv, schema);
    addSchemaIfMissing(workManagementAjv, schema);
    if (schemaFile.startsWith(WORK_MANAGEMENT_SCHEMA_DIR)) {
      workManagementSchemas.push(schema);
    }
  }

  const transitionProfile = compileTransitionProfile(
    parseJsonFile<Record<string, unknown>>(
      join(
        WORK_MANAGEMENT_SCHEMA_DIR,
        "workflows",
        "default",
        "transition-profile.json",
      ),
    ),
    parseJsonFile<Record<string, unknown>>(
      join(
        WORK_MANAGEMENT_SCHEMA_DIR,
        "support",
        "transition-profile.schema.json",
      ),
    ),
    workManagementSchemas,
  );

  const validators = new Map<string, ValidateFunction<unknown>>();
  const schemaValidators = new Map<string, ValidateFunction<unknown>>();
  for (const type of supportedTypes) {
    const latestSchemaPath = join(SCHEMA_DIR, "by-type", type, "latest.json");
    if (!existsSync(latestSchemaPath)) {
      throw new Error(
        `Missing latest schema for type '${type}': ${latestSchemaPath}`,
      );
    }

    const schema = parseJsonFile<Record<string, unknown>>(latestSchemaPath);
    try {
      validators.set(type, ajv.compile(schema));
    } catch {
      // Legacy by-type schemas may contain authoring placeholders such as empty
      // enums. Explicit $schema paths still compile through the work-management
      // registry; keep deprecated fallback routing best-effort.
    }
  }

  return {
    ajv,
    workManagementAjv,
    validators,
    schemaValidators,
    transitionProfile,
    supportedTypes,
  };
}

function selectAjvForSchemaPath(
  schemaPath: string,
  ajv: AjvLike,
  workManagementAjv: AjvLike,
): AjvLike {
  return schemaPath.startsWith(WORK_MANAGEMENT_SCHEMA_DIR)
    ? workManagementAjv
    : ajv;
}

function resolveValidatorForFrontmatter(
  ajv: AjvLike,
  workManagementAjv: AjvLike,
  validators: Map<string, ValidateFunction<unknown>>,
  schemaValidators: Map<string, ValidateFunction<unknown>>,
  frontmatter: Record<string, unknown>,
): ValidateFunction<unknown> | undefined {
  const schemaRef =
    typeof frontmatter.$schema === "string" ? frontmatter.$schema : null;

  if (schemaRef) {
    const resolvedPath = resolveSchemaPath(schemaRef);
    if (existsSync(resolvedPath)) {
      const selectedAjv = selectAjvForSchemaPath(
        resolvedPath,
        ajv,
        workManagementAjv,
      );
      const cachedValidator = schemaValidators.get(resolvedPath);
      if (cachedValidator) {
        return cachedValidator;
      }

      const schema = parseJsonFile<Record<string, unknown>>(resolvedPath);
      const schemaId = typeof schema.$id === "string" ? schema.$id : null;
      if (schemaId) {
        const registeredValidator = selectedAjv.getSchema(schemaId);
        if (registeredValidator) {
          schemaValidators.set(resolvedPath, registeredValidator);
          return registeredValidator;
        }
      }

      const compiledValidator = selectedAjv.compile(schema);
      schemaValidators.set(resolvedPath, compiledValidator);
      return compiledValidator;
    }
  }

  const type = typeof frontmatter.type === "string" ? frontmatter.type : null;
  return type ? validators.get(type) : undefined;
}

let cachedComparisonRef: string | null | undefined;
let cachedChangedBacklogFiles: Set<string> | undefined;

function runGitForRef(args: string[]): string | null {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0 || !result.stdout) {
    return null;
  }

  const output = result.stdout.trim();
  return output.length > 0 ? output : null;
}

function resolveComparisonRef(): string | null {
  if (cachedComparisonRef !== undefined) {
    return cachedComparisonRef;
  }

  const explicitBaseRef =
    process.env.PR_BASE_SHA?.trim() ||
    process.env.GITHUB_BASE_SHA?.trim() ||
    null;
  if (explicitBaseRef) {
    const verified = runGitForRef([
      "rev-parse",
      "--verify",
      `${explicitBaseRef}^{commit}`,
    ]);
    if (verified) {
      cachedComparisonRef = verified;
      return cachedComparisonRef;
    }
  }

  const baseBranch = process.env.GITHUB_BASE_REF?.trim();
  if (baseBranch) {
    const mergeBase = runGitForRef([
      "merge-base",
      "HEAD",
      `origin/${baseBranch}`,
    ]);
    if (mergeBase) {
      cachedComparisonRef = mergeBase;
      return cachedComparisonRef;
    }
  }

  const previousHead = runGitForRef(["rev-parse", "--verify", "HEAD~1"]);
  cachedComparisonRef = previousHead;
  return cachedComparisonRef;
}

function hasBacklogFileChangedSinceComparison(file: string): boolean {
  const comparisonRef = resolveComparisonRef();
  if (!comparisonRef) {
    return false;
  }

  if (!cachedChangedBacklogFiles) {
    const changedOutput = runGitForRef([
      "diff",
      "--name-only",
      comparisonRef,
      "--",
      "backlog",
    ]);
    cachedChangedBacklogFiles = new Set(
      (changedOutput ?? "")
        .split("\n")
        .map((entry) => toPosixPath(entry.trim()))
        .filter(Boolean),
    );
  }

  return cachedChangedBacklogFiles.has(`backlog/${file}`);
}

/**
 * Get previous committed frontmatter from git for a backlog file.
 * Uses a stable baseline ref (PR base SHA, merge-base, or HEAD~1 fallback).
 * Returns null for new/untracked files or files without valid frontmatter.
 */
function getPreviousFrontmatterFromGit(
  file: string,
): Record<string, unknown> | null {
  const comparisonRef = resolveComparisonRef();
  if (!comparisonRef) {
    return null;
  }

  const gitPath = `${comparisonRef}:backlog/${file}`;
  const result = spawnSync("git", ["show", gitPath], {
    cwd: process.cwd(),
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0 || !result.stdout) {
    return null;
  }

  try {
    return parseFrontmatter(result.stdout);
  } catch {
    return null;
  }
}

function isWorkManagementWorkItemSchema(
  frontmatter: Record<string, unknown>,
): boolean {
  return (
    frontmatter.$schema === "schemas/work-management/frontmatter/work-item.json"
  );
}

function describeState(
  profile: CompiledTransitionProfile,
  frontmatter: Record<string, unknown>,
): string {
  const state = resolveStateVector(profile, frontmatter);
  return Object.entries(state)
    .map(([dimension, value]) => `${dimension}=${value ?? "<missing>"}`)
    .join(", ");
}

function toPosixPath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

/**
 * Resolve files to validate from optional CLI args.
 * - No args: validate all backlog markdown files.
 * - Args present: validate only matching backlog markdown files.
 */
function resolveFilesToValidate(
  allBacklogFiles: string[],
  cliArgs: string[],
  backlogDir: string,
): string[] {
  if (cliArgs.length === 0) {
    return allBacklogFiles;
  }

  const allFilesSet = new Set(allBacklogFiles);
  const selectedFiles: string[] = [];
  const selectedSet = new Set<string>();

  const addIfValid = (candidate: string): void => {
    if (allFilesSet.has(candidate) && !selectedSet.has(candidate)) {
      selectedSet.add(candidate);
      selectedFiles.push(candidate);
    }
  };

  for (const rawArg of cliArgs) {
    if (
      !rawArg ||
      rawArg.startsWith("-") ||
      !rawArg.toLowerCase().endsWith(".md")
    ) {
      continue;
    }

    const normalizedArg = toPosixPath(rawArg.replace(/^\.\/+/, ""));

    if (allFilesSet.has(normalizedArg)) {
      addIfValid(normalizedArg);
      continue;
    }

    if (normalizedArg.startsWith("backlog/")) {
      addIfValid(normalizedArg.slice("backlog/".length));
      continue;
    }

    const absolutePath = isAbsolute(rawArg)
      ? normalize(rawArg)
      : resolve(process.cwd(), rawArg);
    const relativePath = toPosixPath(relative(backlogDir, absolutePath));

    if (!relativePath || relativePath.startsWith("..")) {
      continue;
    }

    addIfValid(relativePath);
  }

  return selectedFiles;
}

/**
 * Main validation function
 */
export function validateFrontmatter(args = process.argv.slice(2)): boolean {
  const {
    ajv,
    workManagementAjv,
    validators,
    schemaValidators,
    transitionProfile,
    supportedTypes,
  } = loadSchemas();
  const consumerConfig = loadConsumerSeverityConfig();
  const backlogDir = resolve(
    process.cwd(),
    consumerConfig.roots?.backlog ?? "backlog",
  );
  const archiveDir = resolve(
    process.cwd(),
    consumerConfig.roots?.archive ?? "backlog/archive",
  );
  const { strict: strictMode, fileArgs } = parseCliArgs(args);
  const allBacklogFiles = collectBacklogMarkdownFiles(backlogDir);
  const files = resolveFilesToValidate(allBacklogFiles, fileArgs, backlogDir);
  let hasViolations = false;
  let warningCount = 0;

  if (files.length === 0) {
    console.log("\nNo backlog frontmatter files to validate.\n");
    return true;
  }

  // First pass: Load all work-items into a map for dependency checking
  const workItemsMap = new Map<string, WorkItemRef>();

  for (const file of allBacklogFiles) {
    try {
      const filePath = join(backlogDir, file);
      const content = readFileSync(filePath, "utf-8");
      const frontmatter = parseFrontmatter(content);
      if (frontmatter.type !== "work-item") {
        continue;
      }

      const fileBasename = file.replace(/\.md$/, "");
      const fileLeafBasename = fileBasename.split("/").pop() || fileBasename;
      const id =
        typeof frontmatter.id === "string" ? frontmatter.id : fileBasename;
      const status =
        typeof frontmatter.status === "string" ? frontmatter.status : "";
      const title =
        typeof frontmatter.title === "string" ? frontmatter.title : file;

      workItemsMap.set(fileBasename, { status, file, id, title });
      const existingByLeaf = workItemsMap.get(fileLeafBasename);
      if (existingByLeaf && existingByLeaf.file !== file) {
        console.error(
          `Backlog frontmatter error: multiple work items share the same leaf name "${fileLeafBasename}": ` +
            `${existingByLeaf.file} and ${file}. ` +
            "Use a unique file name or reference work items by full path or id.",
        );
        hasViolations = true;
      } else if (!existingByLeaf) {
        workItemsMap.set(fileLeafBasename, { status, file, id, title });
      }
      if (typeof frontmatter.id === "string") {
        workItemsMap.set(id, { status, file, id, title });
      }
    } catch {
      // Will be caught in main validation loop
    }
  }

  console.log(
    `\nValidating ${files.length} backlog frontmatter file(s) against JSON schema...\n`,
  );

  // Second pass: Validate each backlog frontmatter file
  for (const file of files) {
    try {
      const filePath = join(backlogDir, file);
      const content = readFileSync(filePath, "utf-8");
      const frontmatter = parseFrontmatter(content);
      const type = frontmatter.type;
      const validator = resolveValidatorForFrontmatter(
        ajv,
        workManagementAjv,
        validators,
        schemaValidators,
        frontmatter,
      );

      if (!validator) {
        hasViolations = true;
        const received = typeof type === "string" ? type : "<missing>";
        console.error(`❌ ${file}`);
        console.error(
          `   /type: Unsupported frontmatter type '${received}'. Supported types: [${supportedTypes.join(
            ", ",
          )}]`,
        );
        console.error();
        continue;
      }

      const valid = validator(frontmatter);

      const diagnostics: FrontmatterDiagnostic[] = [];
      const strictMaskingNotices = new Set<string>();

      // Schema validation errors
      if (!valid && validator.errors) {
        hasViolations = true;

        for (const error of validator.errors) {
          const path = error.instancePath || "(root)";
          const message = error.message || "validation error";

          diagnostics.push({
            code: "schema-validation",
            path,
            message:
              error.params && Object.keys(error.params).length > 0
                ? `${message} params=${JSON.stringify(error.params)}`
                : message,
            severity: "error",
          });
        }
      }

      // Work-item-only validations: status transitions and dependency checks
      if (type === "work-item") {
        const isDefaultWorkManagementWorkItem =
          isWorkManagementWorkItemSchema(frontmatter);
        const status = frontmatter.status as string;
        const previousFrontmatter = getPreviousFrontmatterFromGit(file);
        const previousStatus =
          typeof previousFrontmatter?.status === "string"
            ? previousFrontmatter.status
            : null;
        const previousReason =
          typeof previousFrontmatter?.status_reason === "string"
            ? previousFrontmatter.status_reason.trim()
            : null;
        const currentReason =
          typeof frontmatter.status_reason === "string"
            ? frontmatter.status_reason.trim()
            : null;

        if (
          previousFrontmatter &&
          status === previousStatus &&
          currentReason !== previousReason
        ) {
          diagnostics.push({
            code: "transition-reason-churn",
            path: "/status_reason",
            message: "Status reason changed without changing status",
            severity: "warn",
            semantic: true,
          });
        }

        const pullRequests = Array.isArray(frontmatter.links?.pull_requests)
          ? (frontmatter.links.pull_requests as string[])
          : [];

        const isEnteringCompleted =
          status === "completed" && previousStatus !== "completed";
        if (isEnteringCompleted && pullRequests.length === 0) {
          diagnostics.push({
            code: "completed-pr-link",
            path: "/links/pull_requests",
            message:
              "Work item is entering 'completed' but has no linked pull request",
            severity: "error",
          });
        }

        const legacyDependsOn = Array.isArray(frontmatter.links?.depends_on)
          ? (frontmatter.links.depends_on as string[])
          : [];
        const canonicalDependsOn = extractCanonicalRelationshipDependencies(
          content,
        ).map((ref) => `[[${ref}]]`);
        const dependencyRefs = [...legacyDependsOn, ...canonicalDependsOn];

        if (status === "completed") {
          for (const dep of dependencyRefs) {
            const depRef = extractWikilinkTarget(dep);
            if (!depRef) {
              continue;
            }

            const depItem = workItemsMap.get(depRef);

            if (!depItem) {
              diagnostics.push({
                code: "depends-on-not-found",
                path: "/links/depends_on",
                message: `Dependency '${dep}' not found in backlog`,
                severity: "error",
              });
            } else if (!["completed", "aborted"].includes(depItem.status)) {
              diagnostics.push({
                code: "depends-on-completed-required",
                path: "/links/depends_on",
                message: `Dependency '${dep}' (${depItem.id}: ${depItem.title}) must be terminal before work item can enter 'completed' but is '${depItem.status}'`,
                severity: "error",
              });
            }
          }
        }

        const terminalStatuses = ["completed", "aborted"];
        const isTerminal = terminalStatuses.includes(status);
        const isEnteringTerminal =
          isTerminal && !terminalStatuses.includes(previousStatus ?? "");
        const shouldEnforceClosedInvariants =
          isTerminal &&
          (isEnteringTerminal || hasBacklogFileChangedSinceComparison(file));

        if (shouldEnforceClosedInvariants) {
          const closedStatusReason =
            typeof frontmatter.status_reason === "string"
              ? frontmatter.status_reason.trim()
              : "";
          const completedDate =
            typeof frontmatter.completed_date === "string"
              ? frontmatter.completed_date.trim()
              : "";

          if (!closedStatusReason) {
            diagnostics.push({
              code: "closed-missing-reason",
              path: "/status_reason",
              message: "Work item is terminal but status_reason is missing",
              severity: "error",
            });
          }

          if (!completedDate) {
            diagnostics.push({
              code: "closed-missing-completed-date",
              path: "/completed_date",
              message: "Work item is terminal but completed_date is missing",
              severity: "error",
            });
          }

          const evidenceNotePattern = new RegExp(
            String.raw`^- \d{4}-\d{2}-\d{2}: Closed as \w+ with evidence in backlog\/audit\/auditing-backlog-report\.json\.$`,
            "m",
          );
          if (!evidenceNotePattern.test(content)) {
            diagnostics.push({
              code: "closed-missing-evidence-note",
              path: "/body",
              message:
                "Work item is terminal but missing the required timestamped evidence note",
              severity: "error",
            });
          }
        }

        if (
          isDefaultWorkManagementWorkItem &&
          previousFrontmatter &&
          typeof status === "string"
        ) {
          try {
            const previousState = resolveStateVector(
              transitionProfile,
              previousFrontmatter,
            );
            const currentState = resolveStateVector(
              transitionProfile,
              frontmatter,
            );
            const transition = evaluateTransition(
              previousState,
              currentState,
              transitionProfile.transitions,
            );

            if (!transition.allowed) {
              diagnostics.push({
                code: "status-transition-invalid",
                path: "/status",
                message: `Invalid transition from '${describeState(
                  transitionProfile,
                  previousFrontmatter,
                )}' to '${describeState(transitionProfile, frontmatter)}'`,
                severity: "error",
              });
            }
          } catch (error) {
            diagnostics.push({
              code: "status-transition-state-invalid",
              path: "/status",
              message: (error as Error).message,
              severity: "error",
            });
          }
        }

        if (dependencyRefs.length > 0) {
          for (const dep of dependencyRefs) {
            const depRef = extractWikilinkTarget(dep);
            if (depRef) {
              const depItem = workItemsMap.get(depRef);

              if (!depItem) {
                diagnostics.push({
                  code: "depends-on-not-found",
                  path: "/links/depends_on",
                  message: `Dependency '${dep}' not found in backlog`,
                  severity: "error",
                });
              } else if (
                isDefaultWorkManagementWorkItem &&
                !isWithinPath(join(backlogDir, file), archiveDir) &&
                isTerminal &&
                !terminalStatuses.includes(depItem.status)
              ) {
                diagnostics.push({
                  code: "depends-on-closed-required",
                  path: "/links/depends_on",
                  message: `Dependency '${dep}' (${depItem.id}: ${depItem.title}) must be terminal but is '${depItem.status}'`,
                  severity: "error",
                });
              } else if (
                status === "running" &&
                !["running", "completed", "aborted"].includes(depItem.status)
              ) {
                diagnostics.push({
                  code: "depends-on-in-progress-required",
                  path: "/links/depends_on",
                  message: `Dependency '${dep}' (${depItem.id}: ${depItem.title}) must be 'running', 'completed', or 'aborted' but is '${depItem.status}'`,
                  severity: "error",
                });
              }
            }
          }
        }

        if (shouldEnforceClosedInvariants && status === "completed") {
          const uncheckedTasks = extractUncheckedChecklistItemsFromSection(
            content,
            "Tasks",
          );
          const uncheckedAcceptance = extractUncheckedChecklistItemsFromSection(
            content,
            "Acceptance Criteria",
          );

          if (uncheckedTasks.length > 0) {
            diagnostics.push({
              code: "closed-unchecked-tasks",
              path: "/status",
              message: `Work item is terminal but has unchecked Tasks checklist items (${uncheckedTasks.length})`,
              severity: "error",
            });
          }

          if (uncheckedAcceptance.length > 0) {
            diagnostics.push({
              code: "closed-unchecked-acceptance",
              path: "/status",
              message: `Work item is terminal but has unchecked Acceptance Criteria checklist items (${uncheckedAcceptance.length})`,
              severity: "error",
            });
          }
        }
      }

      let printedHeader = false;

      for (const diagnostic of diagnostics) {
        const strictResult = applyStrictSeverity(
          diagnostic,
          strictMode,
          consumerConfig,
        );
        const effectiveSeverity = strictResult.severity;

        if (effectiveSeverity === "error") {
          hasViolations = true;
        } else if (effectiveSeverity === "warn") {
          warningCount += 1;
        }

        if (!printedHeader) {
          printedHeader = true;
          console.error(`❌ ${file}`);
        }

        if (strictResult.masked) {
          strictMaskingNotices.add(
            `strict escalation masked by consumer policy for diagnostic '${diagnostic.code}'`,
          );
        }

        console.error(
          `   [${effectiveSeverity}] ${diagnostic.path}: ${diagnostic.message}`,
        );
      }

      for (const notice of strictMaskingNotices) {
        console.error(`   [info] ${notice}`);
      }

      if (printedHeader) {
        console.error();
      }
    } catch (e) {
      hasViolations = true;

      console.error(`❌ ${file}: ${(e as Error).message}\n`);
    }
  }

  if (!hasViolations) {
    console.log("✅ All backlog frontmatter files passed schema validation\n");
    if (warningCount > 0) {
      console.log(`⚠️  ${warningCount} warning(s) reported`);
    }
  } else {
    console.error(
      "\n❌ Schema validation failed. Please fix the above issues.\n",
    );
  }

  return !hasViolations;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const success = validateFrontmatter();
  process.exit(success ? 0 : 1);
}
