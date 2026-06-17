import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import matter from "gray-matter";
import { promises as fs } from "node:fs";
import path from "node:path";

export type ArchiveValidationFormat = "text" | "json";
export type ArchiveValidationFailOn = "error" | "warning";
export type ArchiveValidationSeverity = "none" | "info" | "warn" | "error";

interface ArchiveValidationConfig {
  fallbackSchema: string;
  missingSchemaSeverity: ArchiveValidationSeverity;
  allowedSchemas: string[];
}

interface ConsumerArchiveValidationConfig {
  fallbackSchema?: string;
  missingSchemaSeverity?: ArchiveValidationSeverity | "warning";
  allowedSchemas?: string[];
}

interface ConsumerArchiveValidationConfigLegacy {
  schemas?: {
    archive?: string;
  };
  severity?: {
    archive?: ArchiveValidationSeverity | "warning";
  };
}

interface ConsumerConfig {
  roots?: {
    archive?: string | string[];
  };
  automation?: {
    archiveValidation?: ConsumerArchiveValidationConfig;
    prePushValidation?: ConsumerArchiveValidationConfigLegacy;
  };
}

export interface ArchiveValidationOptions {
  rootDir?: string;
  consumerConfig?: string;
  format?: ArchiveValidationFormat;
  failOn?: ArchiveValidationFailOn;
}

interface ResolvedArchiveValidationOptions {
  rootDir: string;
  consumerConfig: string;
  format: ArchiveValidationFormat;
  failOn: ArchiveValidationFailOn;
  archiveRoots: string[];
  archiveValidation: ArchiveValidationConfig;
}

interface ArchiveValidationFinding {
  file: string;
  schema: string;
  kind: "declared" | "fallback" | "missing-schema";
  severity: Exclude<ArchiveValidationSeverity, "none">;
  errors: string[];
}

export interface ArchiveValidationReport {
  generatedAt: string;
  options: ResolvedArchiveValidationOptions;
  totals: {
    files: number;
    declaredSchemas: number;
    fallbackSchemas: number;
    missingSchemas: number;
    schemaViolations: number;
    allowedExternalSchemas: number;
  };
  findings: ArchiveValidationFinding[];
  exitCode: number;
}

class ArchiveValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const DEFAULT_FALLBACK_SCHEMA = "schemas/work-management/frontmatter/work-item.json";
const DEFAULT_MISSING_SCHEMA_SEVERITY: ArchiveValidationSeverity = "warn";

function normalizeSeverity(
  value: unknown,
  fallback: ArchiveValidationSeverity,
): ArchiveValidationSeverity {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "warning") return "warn";
  if (
    normalized === "none" ||
    normalized === "info" ||
    normalized === "warn" ||
    normalized === "error"
  ) {
    return normalized;
  }
  return fallback;
}

function isWithinPath(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeArchiveRoots(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim().length > 0 ? [value.trim()] : [];
  }
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return [];
}

function normalizeAllowedSchemas(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function resolveLocalSchemaPath(rootDir: string, schemaSpec: string): string {
  if (schemaSpec.startsWith("file://")) {
    const url = new URL(schemaSpec);
    return url.pathname.endsWith(".json") ? url.pathname : `${url.pathname}.json`;
  }

  if (schemaSpec.startsWith("/frontmatter/")) {
    const relative = schemaSpec.replace(/^\//, "");
    const suffix = relative.endsWith(".json") ? "" : ".json";
    return path.resolve(rootDir, "schemas", `${relative}${suffix}`);
  }

  const suffix = schemaSpec.endsWith(".json") ? "" : ".json";
  const resolved = path.isAbsolute(schemaSpec)
    ? `${schemaSpec}${suffix}`
    : path.resolve(rootDir, `${schemaSpec}${suffix}`);
  return resolved;
}

function normalizeSchemaSpec(rootDir: string, schemaSpec: string): {
  spec: string;
  localPath?: string;
  isExternal: boolean;
} {
  const trimmed = schemaSpec.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return { spec: trimmed, isExternal: true };
  }
  const localPath = resolveLocalSchemaPath(rootDir, trimmed);
  return { spec: trimmed, localPath, isExternal: false };
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function preloadRepoSchemas(
  ajv: Ajv2020,
  rootDir: string,
): Promise<void> {
  const schemasRoot = path.resolve(rootDir, "schemas");
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      try {
        const schema = await readJsonFile<Record<string, unknown>>(fullPath);
        const schemaId = typeof schema.$id === "string" ? schema.$id : null;
        if (schemaId && !ajv.getSchema(schemaId)) {
          ajv.addSchema(schema, schemaId);
        }
      } catch {
        // Ignore broken schemas outside the archive-validation scope.
      }
    }
  }

  await walk(schemasRoot);
}

async function loadConsumerConfig(
  rootDir: string,
  configPath: string,
): Promise<ConsumerConfig> {
  const resolved = path.resolve(rootDir, configPath);
  let raw: string;
  try {
    raw = await fs.readFile(resolved, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new ArchiveValidationError(
        "ARCHIVE_CONFIG_MISSING",
        `Archive validation requires a consumer config at '${path.relative(rootDir, resolved)}'.`,
        { configPath: resolved },
      );
    }
    throw error;
  }

  try {
    return JSON.parse(raw) as ConsumerConfig;
  } catch (error) {
    throw new ArchiveValidationError(
      "ARCHIVE_CONFIG_MALFORMED",
      `Failed to parse archive consumer config at '${path.relative(rootDir, resolved)}': ${
        error instanceof Error ? error.message : String(error)
      }`,
      { configPath: resolved },
    );
  }
}

async function resolveOptions(
  cliOptions: ArchiveValidationOptions,
): Promise<ResolvedArchiveValidationOptions> {
  const rootDir = path.resolve(cliOptions.rootDir ?? process.cwd());
  const consumerConfigPath =
    cliOptions.consumerConfig ?? ".doc-vader/backlog-consumer.json";
  const config = await loadConsumerConfig(rootDir, consumerConfigPath);
  const archiveRoots = normalizeArchiveRoots(config.roots?.archive);
  if (archiveRoots.length === 0) {
    throw new ArchiveValidationError(
      "ARCHIVE_ROOTS_MISSING",
      "Archive validation requires roots.archive to be configured in the consumer config.",
      { consumerConfigPath: path.resolve(rootDir, consumerConfigPath) },
    );
  }

  const legacyArchiveValidation = config.automation?.prePushValidation;
  const configuredArchiveValidation = config.automation?.archiveValidation;
  const archiveValidation = configuredArchiveValidation ?? {
    fallbackSchema:
      legacyArchiveValidation?.schemas?.archive ?? DEFAULT_FALLBACK_SCHEMA,
    missingSchemaSeverity: normalizeSeverity(
      legacyArchiveValidation?.severity?.archive,
      DEFAULT_MISSING_SCHEMA_SEVERITY,
    ),
    allowedSchemas: [],
  };

  const fallbackSchema = archiveValidation.fallbackSchema?.trim() || DEFAULT_FALLBACK_SCHEMA;
  const missingSchemaSeverity = normalizeSeverity(
    archiveValidation.missingSchemaSeverity,
    DEFAULT_MISSING_SCHEMA_SEVERITY,
  );
  const allowedSchemas = normalizeAllowedSchemas(archiveValidation.allowedSchemas);

  return {
    rootDir,
    consumerConfig: consumerConfigPath,
    format: cliOptions.format ?? "text",
    failOn: cliOptions.failOn ?? "error",
    archiveRoots,
    archiveValidation: {
      fallbackSchema,
      missingSchemaSeverity,
      allowedSchemas,
    },
  };
}

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(full)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files.sort();
}

function severityRank(value: ArchiveValidationSeverity): number {
  switch (value) {
    case "none":
      return 0;
    case "info":
      return 1;
    case "warn":
      return 2;
    case "error":
      return 3;
  }
}

function shouldFailOn(severity: ArchiveValidationSeverity, failOn: ArchiveValidationFailOn): boolean {
  if (severity === "none") {
    return false;
  }
  if (failOn === "warning") {
    return severityRank(severity) >= severityRank("warn");
  }
  return severityRank(severity) >= severityRank("error");
}

async function loadSchema(
  rootDir: string,
  schemaSpec: string,
  allowedSchemas: string[],
): Promise<{ schema: Record<string, unknown>; isExternal: boolean }> {
  const normalized = normalizeSchemaSpec(rootDir, schemaSpec);
  if (normalized.isExternal) {
    if (!allowedSchemas.includes(normalized.spec)) {
      throw new ArchiveValidationError(
        "ARCHIVE_SCHEMA_NOT_ALLOWED",
        `Archive schema '${normalized.spec}' is not repo-local or explicitly allowlisted.`,
        { schema: normalized.spec },
      );
    }
    const response = await fetch(normalized.spec);
    if (!response.ok) {
      throw new ArchiveValidationError(
        "ARCHIVE_SCHEMA_FETCH_FAILED",
        `Failed to fetch allowlisted archive schema '${normalized.spec}': ${response.status} ${response.statusText}`,
        { schema: normalized.spec },
      );
    }
    return {
      schema: (await response.json()) as Record<string, unknown>,
      isExternal: true,
    };
  }

  if (!normalized.localPath) {
    throw new ArchiveValidationError(
      "ARCHIVE_SCHEMA_INVALID",
      `Archive schema '${normalized.spec}' could not be resolved.`,
      { schema: normalized.spec },
    );
  }
  if (!isWithinPath(normalized.localPath, rootDir)) {
    throw new ArchiveValidationError(
      "ARCHIVE_SCHEMA_OUTSIDE_REPO",
      `Archive schema '${normalized.spec}' resolves outside the repository root.`,
      { schema: normalized.spec, path: normalized.localPath },
    );
  }
  return {
    schema: await readJsonFile<Record<string, unknown>>(normalized.localPath),
    isExternal: false,
  };
}

function formatFinding(finding: ArchiveValidationFinding): string {
  let prefix: string;
  switch (finding.kind) {
    case "missing-schema":
      prefix = "missing schema";
      break;
    case "fallback":
      prefix = "fallback schema";
      break;
    case "declared":
      prefix = "declared schema";
      break;
  }
  const errors = finding.errors.join("; ");
  return `${finding.file}: ${prefix} '${finding.schema}' [${finding.severity}]${errors.length > 0 ? ` - ${errors}` : ""}`;
}

function toReportFilePath(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).replaceAll("\\", "/");
}

function formatReportText(report: ArchiveValidationReport): string {
  const lines: string[] = [];
  lines.push("Archive Validation Report");
  lines.push("=========================");
  lines.push(`rootDir=${report.options.rootDir}`);
  lines.push(`archiveRoots=${report.options.archiveRoots.join(",")}`);
  lines.push(
    `files=${report.totals.files} declared=${report.totals.declaredSchemas} fallback=${report.totals.fallbackSchemas} missing=${report.totals.missingSchemas} violations=${report.totals.schemaViolations}`,
  );
  if (report.findings.length > 0) {
    lines.push("");
    for (const finding of report.findings) {
      lines.push(formatFinding(finding));
    }
  }
  lines.push("");
  lines.push(`exit_code=${report.exitCode}`);
  return lines.join("\n");
}

export function formatArchiveValidationReportText(
  report: ArchiveValidationReport,
): string {
  return formatReportText(report);
}

export function formatArchiveValidationReportJson(
  report: ArchiveValidationReport,
): string {
  return JSON.stringify(report, null, 2);
}

export function formatArchiveValidationReport(
  report: ArchiveValidationReport,
): string {
  return report.options.format === "json"
    ? formatArchiveValidationReportJson(report)
    : formatArchiveValidationReportText(report);
}

export async function validateArchiveWorkItems(
  cliOptions: ArchiveValidationOptions = {},
): Promise<ArchiveValidationReport> {
  const options = await resolveOptions(cliOptions);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  await preloadRepoSchemas(ajv, options.rootDir);

  const findings: ArchiveValidationFinding[] = [];
  const files = (
    await Promise.all(
      options.archiveRoots.map(async (archiveRoot) =>
        collectMarkdownFiles(path.resolve(options.rootDir, archiveRoot)),
      ),
    )
  )
    .flat()
    .sort();

  const seenFiles = new Set<string>();
  const uniqueFiles = files.filter((file) => {
    if (seenFiles.has(file)) return false;
    seenFiles.add(file);
    return true;
  });

  let declaredSchemas = 0;
  let fallbackSchemas = 0;
  let missingSchemas = 0;
  let schemaViolations = 0;
  let allowedExternalSchemas = 0;

  for (const filePath of uniqueFiles) {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = matter(raw);
    const frontmatter = (parsed.data ?? {}) as Record<string, unknown>;
    if (frontmatter.type !== "work-item") {
      continue;
    }

    const declaredSchema =
      typeof frontmatter.$schema === "string" && frontmatter.$schema.trim().length > 0
        ? frontmatter.$schema.trim()
        : undefined;
    const schemaSpec = declaredSchema ?? options.archiveValidation.fallbackSchema;
    const kind = declaredSchema ? "declared" : "fallback";
    if (declaredSchema) {
      declaredSchemas += 1;
    } else {
      fallbackSchemas += 1;
      missingSchemas += 1;
      if (options.archiveValidation.missingSchemaSeverity !== "none") {
        findings.push({
          file: toReportFilePath(options.rootDir, filePath),
          schema: schemaSpec,
          kind: "missing-schema",
          severity: options.archiveValidation.missingSchemaSeverity,
          errors: [
            "Archived work item is missing $schema and used the configured fallback schema.",
          ],
        });
      }
    }

    const schema = await loadSchema(
      options.rootDir,
      schemaSpec,
      options.archiveValidation.allowedSchemas,
    );
    if (schema.isExternal) {
      allowedExternalSchemas += 1;
    }
    const schemaId =
      typeof schema.schema.$id === "string" ? schema.schema.$id : undefined;
    const validate =
      (schemaId ? ajv.getSchema(schemaId) : undefined) ??
      ajv.compile(schema.schema);
    const valid = validate(frontmatter);
    if (!valid) {
      const errors = (validate.errors ?? []).map((error) => {
        const pathPart = error.instancePath || "(root)";
        return `${pathPart} ${error.message ?? "invalid"}`;
      });
      schemaViolations += 1;
      findings.push({
        file: toReportFilePath(options.rootDir, filePath),
        schema: schemaSpec,
        kind,
        severity: "error",
        errors,
      });
    }
  }

  const exitCode = findings.some((finding) => shouldFailOn(finding.severity, options.failOn))
    ? 1
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    options,
    totals: {
      files: uniqueFiles.length,
      declaredSchemas,
      fallbackSchemas,
      missingSchemas,
      schemaViolations,
      allowedExternalSchemas,
    },
    findings,
    exitCode,
  };
}

export { ArchiveValidationError };
