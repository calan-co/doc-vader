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
import { performance } from "node:perf_hooks";
import yaml from "js-yaml";
import { Ajv as LegacyAjv } from "ajv";
import type { ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as formatsPluginModule from "ajv-formats";
import type { FormatsPlugin } from "ajv-formats";
import { fileURLToPath } from "node:url";
import { evaluateWorkItemCompletion } from "./qualifiers.js";
import {
  readFrontmatterGitSnapshot,
  type FrontmatterGitSnapshot,
  type FrontmatterGitSnapshotTraceStage,
} from "./frontmatter-git-snapshot-reader.js";
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

function addSchemasWithDeferredReferences(
  ajv: AjvLike,
  schemas: readonly Record<string, unknown>[],
): void {
  const pending = [...schemas];
  const failures = new Map<Record<string, unknown>, unknown>();

  while (pending.length > 0) {
    let addedCount = 0;

    for (let index = 0; index < pending.length; ) {
      const schema = pending[index];
      try {
        addSchemaIfMissing(ajv, schema);
        pending.splice(index, 1);
        failures.delete(schema);
        addedCount += 1;
      } catch (error) {
        failures.set(schema, error);
        index += 1;
      }
    }

    if (addedCount === 0) {
      const schema = pending[0];
      const schemaId = typeof schema.$id === "string" ? schema.$id : "<unknown>";
      const failure = failures.get(schema);
      throw new Error(
        `Failed to register schema '${schemaId}': ${
          failure instanceof Error ? failure.message : String(failure)
        }`,
        { cause: failure },
      );
    }
  }
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

/** Resolve repository-default workflow dimensions, including the derived category. */
export function resolveDefaultWorkItemState(document: unknown) {
  const normalized =
    document && typeof document === "object"
      ? {
          ...(document as Record<string, unknown>),
          ...(
            typeof (document as Record<string, unknown>).reason === "string" &&
            (document as Record<string, unknown>).status_reason === undefined
              ? { status_reason: (document as Record<string, unknown>).reason }
              : {}
          ),
        }
      : document;
  return resolveStateVector(getDefaultTransitionProfile(), normalized);
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

function loadConsumerSeverityConfig(rootDir = process.cwd()): ConsumerSeverityConfig {
  const consumerConfigPath = join(rootDir, ".doc-vader", "backlog-consumer.json");
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

function shouldSkipArchiveValidation(
  file: string,
  backlogDir: string,
  archiveDir: string,
  consumerConfig: ConsumerSeverityConfig,
): boolean {
  const archiveSeverity =
    consumerConfig.automation?.prePushValidation?.severity?.archive;
  return (
    archiveSeverity === "none" &&
    isWithinPath(join(backlogDir, file), archiveDir)
  );
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
  const workspaceCandidate = join(process.cwd(), normalized);
  if (existsSync(workspaceCandidate)) {
    return workspaceCandidate;
  }

  if (!workspaceCandidate.endsWith(".json") && existsSync(`${workspaceCandidate}.json`)) {
    return `${workspaceCandidate}.json`;
  }

  const rootCandidate = join(SCHEMAS_ROOT, schemaRelative);
  if (existsSync(rootCandidate)) {
    return rootCandidate;
  }

  if (!rootCandidate.endsWith(".json") && existsSync(`${rootCandidate}.json`)) {
    return `${rootCandidate}.json`;
  }

  const fallback = join(SCHEMA_DIR, schemaRelative);
  return fallback.endsWith(".json") ? fallback : `${fallback}.json`;
}

function collectSchemaFiles(dirPath: string): string[] {
  const files: string[] = [];
  if (!existsSync(dirPath)) {
    return files;
  }

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
  const workspaceSchemaRoot = join(process.cwd(), "schemas");
  const workspaceFrontmatterSchemaDir = join(workspaceSchemaRoot, "frontmatter");
  const workspaceWorkManagementSchemaDir = join(
    workspaceSchemaRoot,
    "work-management",
  );
  const schemaFiles = [
    ...new Set([
      ...collectSchemaFiles(workspaceFrontmatterSchemaDir),
      ...collectSchemaFiles(workspaceWorkManagementSchemaDir),
      ...collectSchemaFiles(SCHEMA_DIR),
      ...collectSchemaFiles(WORK_MANAGEMENT_SCHEMA_DIR),
    ]),
  ].sort();
  const schemasToRegister: Record<string, unknown>[] = [];
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
    schemasToRegister.push(schema);
    if (
      schemaFile.startsWith(WORK_MANAGEMENT_SCHEMA_DIR) ||
      schemaFile.startsWith(workspaceWorkManagementSchemaDir)
    ) {
      workManagementSchemas.push(schema);
    }
  }

  addSchemasWithDeferredReferences(ajv, schemasToRegister);
  addSchemasWithDeferredReferences(workManagementAjv, schemasToRegister);
  for (const validator of [ajv, workManagementAjv]) {
    const baseSchema = schemasToRegister.find(
      (schema) => schema.$id === "https://raw.githubusercontent.com/calan-co/doc-vader/main/schemas/frontmatter/support/base/current",
    );
    if (
      baseSchema &&
      !validator.getSchema(
        "https://raw.githubusercontent.com/calan-co/doc-vader/main/schemas/frontmatter/support/base/1.0.0",
      )
    ) {
      validator.addSchema({
        ...baseSchema,
        $id: "https://raw.githubusercontent.com/calan-co/doc-vader/main/schemas/frontmatter/support/base/1.0.0",
      });
    }
  }

  const workspaceTransitionProfilePath = join(
    workspaceWorkManagementSchemaDir,
    "workflows",
    "default",
    "transition-profile.json",
  );
  const workspaceTransitionProfileSchemaPath = join(
    workspaceWorkManagementSchemaDir,
    "support",
    "transition-profile.schema.json",
  );
  const transitionProfile = compileTransitionProfile(
    parseJsonFile<Record<string, unknown>>(
      existsSync(workspaceTransitionProfilePath)
        ? workspaceTransitionProfilePath
        : join(
            WORK_MANAGEMENT_SCHEMA_DIR,
            "workflows",
            "default",
            "transition-profile.json",
          ),
    ),
    parseJsonFile<Record<string, unknown>>(
      existsSync(workspaceTransitionProfileSchemaPath)
        ? workspaceTransitionProfileSchemaPath
        : join(
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

export const FRONTMATTER_GIT_READ_TRACE_STAGES = [
  "selectedLocalRoot",
  "comparisonRefResolution",
  "changedSetRead",
  "historicalContentRead",
  "terminalDiagnosticIntegration",
] as const;

export type FrontmatterGitReadTraceStage =
  (typeof FRONTMATTER_GIT_READ_TRACE_STAGES)[number];

export interface FrontmatterGitReadTraceTiming {
  durationMs: number;
  invocationCount: number;
}

/** Test-only instrumentation for immutable Git reads performed by one lint run. */
export interface FrontmatterGitReadTrace {
  trace<T>(stage: FrontmatterGitReadTraceStage, operation: () => Promise<T>): Promise<T>;
  recordDirectGitSubprocess(durationMs: number): void;
  recordOutcome(stage: FrontmatterGitReadTraceStage, outcome: "value" | "unavailable"): void;
  recordOutcomeState(
    state: "comparisonRef" | "changedSet" | "historicalContent" | "terminalDiagnostics",
    outcome: string,
  ): void;
  recordSelectedLocalRoot(rootDir: string, backlogRoot: string | null): void;
}

export interface FrontmatterGitReadTraceReport extends FrontmatterGitReadTrace {
  operationOnlyMs: number;
  directGitSubprocess: FrontmatterGitReadTraceTiming;
  stages: Record<FrontmatterGitReadTraceStage, FrontmatterGitReadTraceTiming>;
  outcomes: Record<FrontmatterGitReadTraceStage, Record<"value" | "unavailable", number>>;
  selectedLocalRoot?: string;
  backlogRoot?: string;
  comparisonRef?: string;
  changedSet?: string[];
  historicalContentReads: Record<string, "value" | "unavailable">;
  outcomeState: Partial<Record<"comparisonRef" | "changedSet" | "historicalContent" | "terminalDiagnostics", string>>;
}

/** Creates an opt-in collector for tests; production lint calls do not allocate one. */
export function createFrontmatterGitReadTrace(): FrontmatterGitReadTraceReport {
  const timing = (): FrontmatterGitReadTraceTiming => ({ durationMs: 0, invocationCount: 0 });
  const trace: FrontmatterGitReadTraceReport = {
    operationOnlyMs: 0,
    directGitSubprocess: timing(),
    stages: Object.fromEntries(FRONTMATTER_GIT_READ_TRACE_STAGES.map((stage) => [stage, timing()])) as FrontmatterGitReadTraceReport["stages"],
    outcomes: Object.fromEntries(FRONTMATTER_GIT_READ_TRACE_STAGES.map((stage) => [stage, { value: 0, unavailable: 0 }])) as FrontmatterGitReadTraceReport["outcomes"],
    historicalContentReads: {},
    outcomeState: {},
    async trace<T>(stage: FrontmatterGitReadTraceStage, operation: () => Promise<T>): Promise<T> {
      const startedAt = performance.now();
      try {
        return await operation();
      } finally {
        const durationMs = performance.now() - startedAt;
        const timingEntry = this.stages[stage];
        timingEntry.durationMs += durationMs;
        timingEntry.invocationCount += 1;
        this.operationOnlyMs += durationMs;
      }
    },
    recordDirectGitSubprocess(durationMs): void {
      this.directGitSubprocess.invocationCount += 1;
      this.directGitSubprocess.durationMs += durationMs;
    },
    recordOutcome(stage, outcome): void {
      this.outcomes[stage][outcome] += 1;
    },
    recordOutcomeState(state, outcome): void {
      this.outcomeState[state] = outcome;
    },
    recordSelectedLocalRoot(rootDir, backlogRoot): void {
      this.selectedLocalRoot = rootDir;
      if (backlogRoot) {
        this.backlogRoot = backlogRoot;
      }
    },
  };
  return trace;
}

interface FrontmatterGitReadContext {
  rootDir: string;
  backlogRoot: string | null;
  trace?: FrontmatterGitReadTrace;
  snapshot?: FrontmatterGitSnapshot;
}

async function traceGitRead<T>(
  context: FrontmatterGitReadContext,
  stage: FrontmatterGitReadTraceStage,
  operation: () => Promise<T>,
): Promise<T> {
  return context.trace ? context.trace.trace(stage, operation) : operation();
}

function recordGitReadOutcome(
  context: FrontmatterGitReadContext,
  stage: FrontmatterGitReadTraceStage,
  outcome: "value" | "unavailable",
): void {
  context.trace?.recordOutcome(stage, outcome);
}

function getGitReadTraceReport(
  trace: FrontmatterGitReadTrace | undefined,
): FrontmatterGitReadTraceReport | undefined {
  return trace && "historicalContentReads" in trace
    ? (trace as FrontmatterGitReadTraceReport)
    : undefined;
}

function getPreviousFrontmatterFromGit(
  context: FrontmatterGitReadContext,
  file: string,
): Record<string, unknown> | null {
  const historicalPath = `${context.backlogRoot ?? "backlog"}/${file}`;
  const content = context.snapshot?.historicalContents[historicalPath] ?? null;
  if (!content) {
    return null;
  }

  try {
    return parseFrontmatter(content);
  } catch {
    return null;
  }
}

function hasBacklogFileChangedSinceComparison(
  context: FrontmatterGitReadContext,
  file: string,
): boolean {
  const historicalPath = `${context.backlogRoot ?? "backlog"}/${file}`;
  return context.snapshot?.changedPaths.includes(historicalPath) ?? false;
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
  rootDir: string,
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
      : resolve(rootDir, rawArg);
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
export interface ValidateFrontmatterOptions {
  /** Overrides the invocation root for isolated tests and embedded callers. */
  rootDir?: string;
  /** Test-only immutable Git-read instrumentation. */
  gitTrace?: FrontmatterGitReadTrace;
}

export async function validateFrontmatter(
  args = process.argv.slice(2),
  options: ValidateFrontmatterOptions = {},
): Promise<boolean> {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const {
    ajv,
    workManagementAjv,
    validators,
    schemaValidators,
    transitionProfile,
    supportedTypes,
  } = loadSchemas();
  const consumerConfig = loadConsumerSeverityConfig(rootDir);
  const backlogDir = resolve(rootDir, consumerConfig.roots?.backlog ?? "backlog");
  const archiveDir = resolve(rootDir, consumerConfig.roots?.archive ?? "backlog/archive");
  const configuredBacklogRoot = toPosixPath(relative(rootDir, backlogDir));
  const gitBacklogRoot =
    configuredBacklogRoot &&
    !configuredBacklogRoot.startsWith("../") &&
    configuredBacklogRoot !== ".." &&
    !isAbsolute(configuredBacklogRoot)
      ? configuredBacklogRoot
      : null;
  const gitReadContext: FrontmatterGitReadContext = {
    rootDir,
    backlogRoot: gitBacklogRoot,
    trace: options.gitTrace,
  };
  await traceGitRead(gitReadContext, "selectedLocalRoot", async () => {
    options.gitTrace?.recordSelectedLocalRoot(rootDir, gitBacklogRoot);
    recordGitReadOutcome(gitReadContext, "selectedLocalRoot", "value");
  });
  const { strict: strictMode, fileArgs } = parseCliArgs(args);
  const allBacklogFiles = collectBacklogMarkdownFiles(backlogDir);
  const files = resolveFilesToValidate(allBacklogFiles, fileArgs, backlogDir, rootDir);
  let hasViolations = false;
  let warningCount = 0;

  if (files.length === 0) {
    console.log("\nNo backlog frontmatter files to validate.\n");
    return true;
  }

  const candidatePaths = allBacklogFiles.map(
    (file) => `${gitBacklogRoot ?? "backlog"}/${file}`,
  );
  const snapshot = await readFrontmatterGitSnapshot({
    rootDir,
    backlogRoot: gitBacklogRoot,
    candidatePaths,
    trace: options.gitTrace
      ? {
          trace: (stage: FrontmatterGitSnapshotTraceStage, operation) =>
            traceGitRead(gitReadContext, stage, operation),
          recordOutcome: (stage, outcome) =>
            recordGitReadOutcome(gitReadContext, stage, outcome),
        }
      : undefined,
  });
  gitReadContext.snapshot = snapshot;
  options.gitTrace?.recordOutcomeState(
    "comparisonRef",
    snapshot.comparisonRef ? "resolved" : "unavailable",
  );
  const traceReport = getGitReadTraceReport(options.gitTrace);
  if (snapshot.comparisonRef && traceReport) {
    traceReport.comparisonRef = snapshot.comparisonRef;
  }
  if (snapshot.comparisonRef && gitBacklogRoot) {
    options.gitTrace?.recordOutcomeState("changedSet", "value");
    if (traceReport) {
      traceReport.changedSet = [...snapshot.changedPaths];
    }
  }
  for (const candidatePath of candidatePaths) {
    const historicalContent = snapshot.historicalContents[candidatePath] ?? null;
    options.gitTrace?.recordOutcomeState(
      "historicalContent",
      historicalContent === null ? "unavailable" : "value",
    );
    if (traceReport) {
      traceReport.historicalContentReads[candidatePath] =
        historicalContent === null ? "unavailable" : "value";
    }
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
    if (shouldSkipArchiveValidation(file, backlogDir, archiveDir, consumerConfig)) {
      continue;
    }

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
        const previousFrontmatter = getPreviousFrontmatterFromGit(gitReadContext, file);
        const previousStatus =
          typeof previousFrontmatter?.status === "string"
            ? previousFrontmatter.status
            : null;
        const hasComparisonRef = gitReadContext.snapshot?.comparisonRef !== null;
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
          isTerminal &&
          hasComparisonRef &&
          !terminalStatuses.includes(previousStatus ?? "");
        const shouldEnforceClosedInvariants =
          isTerminal &&
          (isEnteringTerminal || hasBacklogFileChangedSinceComparison(gitReadContext, file));
        await traceGitRead(gitReadContext, "terminalDiagnosticIntegration", async () => {
          options.gitTrace?.recordOutcomeState(
            "terminalDiagnostics",
            shouldEnforceClosedInvariants ? "enforced" : "not-enforced",
          );
          recordGitReadOutcome(
            gitReadContext,
            "terminalDiagnosticIntegration",
            shouldEnforceClosedInvariants ? "value" : "unavailable",
          );
        });

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
          const completion = evaluateWorkItemCompletion(content);
          for (const scope of completion.children) {
            const uncheckedCount = scope.children.filter(
              (qualifier) => qualifier.status === "unmet",
            ).length;
            const scopeLabel =
              scope.scope === "tasks" ? "Tasks" : "Acceptance Criteria";
            const code =
              scope.scope === "tasks"
                ? "closed-unchecked-tasks"
                : "closed-unchecked-acceptance";

            if (uncheckedCount > 0) {
              diagnostics.push({
                code,
                path: "/status",
                message: `Work item is terminal but has unchecked ${scopeLabel} checklist items (${uncheckedCount})`,
                severity: "error",
              });
            }
            if (scope.status === "indeterminate") {
              diagnostics.push({
                code: "closed-indeterminate-completion",
                path: "/status",
                message: `Work item is terminal but its ${scopeLabel} completion scope is empty or unknown`,
                severity: "error",
              });
            }
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
  const success = await validateFrontmatter();
  process.exit(success ? 0 : 1);
}
