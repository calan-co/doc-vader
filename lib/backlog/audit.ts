import Ajv2020 from "ajv/dist/2020.js";
import { resolveSchema } from "../schema/resolver.js";
import type { ErrorObject } from "ajv";
import matter from "gray-matter";
import { promises as fs } from "node:fs";
import path from "node:path";

export type BacklogFormat = "text" | "json";
export type BacklogFailOn = "error" | "warning";

export interface BacklogAuditOptions {
  backlogDir?: string;
  rootDir?: string;
  format?: BacklogFormat;
  failOn?: BacklogFailOn;
  profile?: string;
  profiles?: string[];
  schemaMap?: string;
  schemaMaps?: string[];
  includeArchive?: boolean;
}

interface ResolvedOptions {
  backlogDir: string;
  rootDir: string;
  format: BacklogFormat;
  failOn: BacklogFailOn;
  schemaMap?: string;
  schemaMaps?: string[];
  includeArchive: boolean;
  profile?: string;
  profiles?: string[];
}

interface SchemaMapConfig {
  default?: string;
  byType?: Record<string, string>;
  bySubtype?: Record<string, string>;
}

interface BacklogItem {
  file: string;
  id: string | null;
  status: string | null;
  lifecycle: string | null;
  title: string | null;
  type: string | null;
  subtype: string | null;
  refs: string[];
  parseError: string | null;
  data: Record<string, unknown>;
}

interface DuplicateIdFinding {
  id: string;
  files: string[];
}

interface UnresolvedWikilinkFinding {
  file: string;
  ref: string;
}

interface ParseErrorFinding {
  file: string;
  error: string;
}

interface NoInboundActiveFinding {
  file: string;
  id: string | null;
  status: string | null;
  title: string | null;
}

interface SchemaViolationFinding {
  file: string;
  schema: string;
  errors: string[];
}

export interface BacklogAuditReport {
  generated_at: string;
  options: ResolvedOptions;
  totals: {
    files: number;
    duplicate_ids: number;
    unresolved_wikilinks: number;
    parse_errors: number;
    no_inbound_active: number;
    schema_violations: number;
  };
  duplicate_ids: DuplicateIdFinding[];
  unresolved_wikilinks: UnresolvedWikilinkFinding[];
  parse_errors: ParseErrorFinding[];
  no_inbound_active: NoInboundActiveFinding[];
  schema_violations: SchemaViolationFinding[];
  schema_load_errors?: SchemaViolationFinding[];
  exit_code: number;
}

const ACTIVE_STATUSES = new Set([
  "open",
  "proposed",
  "ready",
  "accepted",
  "inprogress",
  "in-progress",
  "review",
  "approved",
  "ready-for-review",
  "draft",
]);

const BUILTIN_PROFILES: Record<string, Partial<BacklogAuditOptions>> = {
  default: { failOn: "error", format: "text" },
  strict: { failOn: "warning", format: "text" },
  ci: { failOn: "warning", format: "json" },
};

function toErrorLines(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map(
    (e) => `${e.instancePath || "(root)"} ${e.message}`,
  );
}

async function findMarkdownFiles(
  dir: string,
  includeArchive: boolean,
): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!includeArchive && entry.name === "archive") continue;
      if (entry.name === "audit") continue;
      files.push(...(await findMarkdownFiles(full, includeArchive)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

function normalizeRef(ref: string): string {
  return ref.split("|")[0].split("#")[0].trim();
}

function extractWikilinks(links: unknown): string[] {
  const text = typeof links === "string" ? links : JSON.stringify(links ?? {});
  const refs: string[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(text)) !== null) {
    refs.push(match[1]);
  }
  return refs;
}

function guessSchemaMap(raw: Record<string, unknown>): SchemaMapConfig {
  const rootCandidate =
    (raw.backlogValidation as Record<string, unknown>) ||
    (raw.backlog_validation as Record<string, unknown>) ||
    raw;
  const byType =
    (rootCandidate.byType as Record<string, string>) ||
    (rootCandidate.by_type as Record<string, string>) ||
    (rootCandidate.types as Record<string, string>) ||
    undefined;
  const bySubtype =
    (rootCandidate.bySubtype as Record<string, string>) ||
    (rootCandidate.by_subtype as Record<string, string>) ||
    (rootCandidate.subtypes as Record<string, string>) ||
    undefined;
  const defaultSchema =
    (rootCandidate.default as string) ||
    (rootCandidate.defaultSchema as string) ||
    (rootCandidate.default_schema as string) ||
    undefined;

  // Allow direct schema-map style where top-level keys map type->schema path.
  if (!byType) {
    const maybeTypeMap: Record<string, string> = {};
    for (const [key, value] of Object.entries(rootCandidate)) {
      if (typeof value === "string") {
        maybeTypeMap[key] = value;
      }
    }
    if (Object.keys(maybeTypeMap).length > 0) {
      return {
        default: defaultSchema,
        byType: maybeTypeMap,
        bySubtype,
      };
    }
  }

  return {
    default: defaultSchema,
    byType,
    bySubtype,
  };
}

async function loadJson(filePath: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function resolveLocalPath(rootDir: string, target: string): string {
  if (target.startsWith("/frontmatter/")) {
    const rel = path.join(
      "schemas",
      target.replace(/^\//, "") + (target.endsWith(".json") ? "" : ".json"),
    );
    return path.resolve(rootDir, rel);
  }
  if (path.isAbsolute(target)) return target;
  return path.resolve(rootDir, target);
}

const TEMPLJS_SCHEMA_PREFIX =
  "https://raw.githubusercontent.com/templjs/templ.js/main/";

function toSchemaAlias(rootDir: string, schemaPath: string): string {
  const relativePath = path
    .relative(rootDir, schemaPath)
    .split(path.sep)
    .join("/");
  return `${TEMPLJS_SCHEMA_PREFIX}${relativePath}`;
}

async function addSchemaWithAliases(
  ajv: Ajv2020,
  rootDir: string,
  schemaPath: string,
  schema?: Record<string, unknown>,
): Promise<void> {
  const resolvedSchema = schema ?? (await loadJson(schemaPath));
  const alias = toSchemaAlias(rootDir, schemaPath);
  const schemaId =
    typeof resolvedSchema.$id === "string" ? resolvedSchema.$id : undefined;

  if (!ajv.getSchema(alias)) {
    const aliasSchema =
      schemaId && schemaId !== alias
        ? ({ ...resolvedSchema, $id: alias } as Record<string, unknown>)
        : resolvedSchema;
    ajv.addSchema(aliasSchema, alias);
  }
}

async function preloadSchemaTree(
  ajv: Ajv2020,
  rootDir: string,
  relativeDir: string,
): Promise<void> {
  const schemaRoot = resolveLocalPath(rootDir, relativeDir);
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const schemaPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(schemaPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        await addSchemaWithAliases(ajv, rootDir, schemaPath);
      } catch {
        // Best effort.
      }
    }
  }

  await walk(schemaRoot);
}

async function resolveSchemaMap(
  rootDir: string,
  schemaMapPath?: string,
  schemaMapPaths?: string[],
): Promise<SchemaMapConfig> {
  const defaults: SchemaMapConfig = {
    byType: {
      "work-item": "schemas/frontmatter/by-type/work-item/latest.json",
      document: "schemas/frontmatter/by-type/document/latest.json",
    },
    default: "schemas/frontmatter/by-type/document/latest.json",
  };
  const sources = [
    ...(schemaMapPaths ?? []),
    ...(schemaMapPath ? [schemaMapPath] : []),
  ];
  if (sources.length === 0) return defaults;

  let merged: SchemaMapConfig = {
    default: defaults.default,
    byType: { ...(defaults.byType ?? {}) },
    bySubtype: {},
  };

  for (const source of sources) {
    const resolved = resolveLocalPath(rootDir, source);
    const raw = await loadJson(resolved);
    const parsed = guessSchemaMap(raw);
    merged = {
      default: parsed.default ?? merged.default,
      byType: { ...(merged.byType ?? {}), ...(parsed.byType ?? {}) },
      bySubtype: { ...(merged.bySubtype ?? {}), ...(parsed.bySubtype ?? {}) },
    };
  }

  return merged;
}

function mergeOptions(
  cliOptions: BacklogAuditOptions,
  profileOptions?: Partial<BacklogAuditOptions>,
): ResolvedOptions {
  const merged: BacklogAuditOptions = { ...(profileOptions || {}) };
  for (const [key, value] of Object.entries(cliOptions)) {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  const rootDir = path.resolve(merged.rootDir || process.cwd());
  return {
    backlogDir: path.resolve(rootDir, merged.backlogDir || "backlog"),
    rootDir,
    format: merged.format || "text",
    failOn: merged.failOn || "error",
    schemaMap: merged.schemaMap,
    schemaMaps: merged.schemaMaps,
    includeArchive: merged.includeArchive ?? false,
    profile: merged.profile,
    profiles: normalizeProfiles(merged.profiles, merged.profile),
  };
}

function normalizeProfiles(
  profiles?: string[],
  profile?: string,
): string[] | undefined {
  const merged = [
    ...(profiles ?? []),
    ...(profile ? [profile] : []),
  ]
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (merged.length === 0) return undefined;
  return [...new Set(merged)];
}

async function resolveProfile(
  profile: string | undefined,
  rootDir: string,
): Promise<Partial<BacklogAuditOptions> | undefined> {
  if (!profile) return undefined;
  if (BUILTIN_PROFILES[profile]) return BUILTIN_PROFILES[profile];

  const candidates = [
    profile,
    path.join("profiles", `${profile}.json`),
    path.join("backlog", "profiles", `${profile}.json`),
  ].map((p) => resolveLocalPath(rootDir, p));

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      const raw = (await loadJson(candidate)) as Record<string, unknown>;
      const profileObj =
        (raw.backlogValidation as Record<string, unknown>) ||
        (raw.backlog_validation as Record<string, unknown>) ||
        raw;
      return {
        failOn: (profileObj.failOn as BacklogFailOn) || undefined,
        format: (profileObj.format as BacklogFormat) || undefined,
        schemaMap:
          (profileObj.schemaMap as string) ||
          (profileObj.schema_map as string) ||
          undefined,
        includeArchive:
          typeof profileObj.includeArchive === "boolean"
            ? (profileObj.includeArchive as boolean)
            : typeof profileObj.include_archive === "boolean"
            ? (profileObj.include_archive as boolean)
            : undefined,
      };
    } catch {
      // Continue candidates.
    }
  }
  throw new Error(`Profile not found: ${profile}`);
}

async function resolveProfiles(
  profiles: string[] | undefined,
  rootDir: string,
): Promise<Partial<BacklogAuditOptions> | undefined> {
  if (!profiles || profiles.length === 0) return undefined;

  let merged: Partial<BacklogAuditOptions> = {};
  const schemaMaps: string[] = [];
  for (const profile of profiles) {
    const resolved = await resolveProfile(profile, rootDir);
    if (resolved) {
      if (resolved.schemaMap) schemaMaps.push(resolved.schemaMap);
      merged = { ...merged, ...resolved };
    }
  }
  if (schemaMaps.length > 0) {
    merged.schemaMaps = schemaMaps;
  }
  return merged;
}

export function formatAuditReportText(report: BacklogAuditReport): string {
  const lines: string[] = [];
  lines.push("Backlog Audit Report");
  lines.push("===================");
  lines.push(
    `files=${report.totals.files} duplicate_ids=${report.totals.duplicate_ids} unresolved_wikilinks=${report.totals.unresolved_wikilinks} parse_errors=${report.totals.parse_errors} schema_violations=${report.totals.schema_violations} no_inbound_active=${report.totals.no_inbound_active}`,
  );
  if (report.duplicate_ids.length) {
    lines.push("");
    lines.push("Duplicate IDs:");
    for (const finding of report.duplicate_ids) {
      lines.push(`- ${finding.id}: ${finding.files.join(", ")}`);
    }
  }
  if (report.unresolved_wikilinks.length) {
    lines.push("");
    lines.push("Unresolved Wikilinks:");
    for (const finding of report.unresolved_wikilinks) {
      lines.push(`- ${finding.file} -> ${finding.ref}`);
    }
  }
  if (report.schema_violations.length) {
    lines.push("");
    lines.push("Schema Violations:");
    for (const finding of report.schema_violations) {
      lines.push(`- ${finding.file} (${finding.schema})`);
      for (const err of finding.errors) {
        lines.push(`  * ${err}`);
      }
    }
  }
  if (report.no_inbound_active.length) {
    lines.push("");
    lines.push("No-Inbound Active Candidates:");
    for (const finding of report.no_inbound_active) {
      lines.push(
        `- ${finding.file} | status=${finding.status ?? ""} | id=${
          finding.id ?? ""
        }`,
      );
    }
  }
  lines.push("");
  lines.push(`exit_code=${report.exit_code}`);
  return lines.join("\n");
}

export async function auditBacklog(
  cliOptions: BacklogAuditOptions = {},
): Promise<BacklogAuditReport> {
  const rootDir = path.resolve(cliOptions.rootDir || process.cwd());
  const requestedProfiles = normalizeProfiles(
    cliOptions.profiles,
    cliOptions.profile,
  );
  const profileOptions = await resolveProfiles(requestedProfiles, rootDir);
  const options = mergeOptions(
    {
      ...cliOptions,
      rootDir,
      profiles: requestedProfiles,
      profile: requestedProfiles?.[0],
    },
    profileOptions,
  );
  const schemaMap = await resolveSchemaMap(
    options.rootDir,
    options.schemaMap,
    options.schemaMaps,
  );

  const files = await findMarkdownFiles(
    options.backlogDir,
    options.includeArchive,
  );
  // Keep scan scope configurable, but always include archive files in wikilink
  // resolution so links to archived work items remain resolvable.
  const resolutionFiles = await findMarkdownFiles(options.backlogDir, true);
  const items: BacklogItem[] = [];
  const idToFiles = new Map<string, string[]>();
  const basenameToFile = new Map<string, string>();
  const parseErrors: ParseErrorFinding[] = [];

  for (const absFile of resolutionFiles) {
    const rel = path.relative(options.rootDir, absFile).replaceAll("\\", "/");
    basenameToFile.set(path.basename(absFile, ".md"), rel);
  }

  for (const absFile of files) {
    const rel = path.relative(options.rootDir, absFile).replaceAll("\\", "/");
    const raw = await fs.readFile(absFile, "utf8");
    let parsed;
    try {
      parsed = matter(raw);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      parseErrors.push({ file: rel, error });
      items.push({
        file: rel,
        id: null,
        status: null,
        lifecycle: null,
        title: null,
        type: null,
        subtype: null,
        refs: [],
        parseError: error,
        data: {},
      });
      continue;
    }
    const data = (parsed.data || {}) as Record<string, unknown>;
    const id = data.id != null ? String(data.id) : null;
    const item: BacklogItem = {
      file: rel,
      id,
      status: data.status != null ? String(data.status) : null,
      lifecycle: data.lifecycle != null ? String(data.lifecycle) : null,
      title: data.title != null ? String(data.title) : null,
      type:
        data.type != null
          ? String(data.type)
          : data.workItemType != null
          ? "work-item"
          : null,
      subtype: data.subtype != null ? String(data.subtype) : null,
      refs: extractWikilinks(data.links),
      parseError: null,
      data,
    };
    items.push(item);
    if (id) {
      if (!idToFiles.has(id)) idToFiles.set(id, []);
      idToFiles.get(id)!.push(rel);
    }
  }

  const duplicateIds: DuplicateIdFinding[] = [...idToFiles.entries()]
    .filter(([, fileList]) => fileList.length > 1)
    .map(([id, fileList]) => ({ id, files: fileList.sort() }))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  const inbound = new Map<string, string[]>();
  for (const item of items) inbound.set(item.file, []);

  const unresolved: UnresolvedWikilinkFinding[] = [];
  for (const item of items) {
    for (const rawRef of item.refs) {
      const normalized = normalizeRef(rawRef);
      const key = normalized.replace(/\.md$/, "");
      if (basenameToFile.has(key)) {
        const target = basenameToFile.get(key)!;
        inbound.get(target)?.push(item.file);
        continue;
      }
      const candidates = [
        normalized,
        normalized.endsWith(".md") ? "" : `${normalized}.md`,
      ].filter(Boolean);
      let resolved = false;
      for (const candidate of candidates) {
        const relCandidates = [
          candidate,
          path.join("backlog", candidate),
          path.join("docs", candidate),
          path.join("schemas", candidate),
          path.join("schemas", "frontmatter", candidate),
        ];
        for (const relCandidate of relCandidates) {
          const fullCandidate = path.resolve(options.rootDir, relCandidate);
          try {
            await fs.access(fullCandidate);
            resolved = true;
            break;
          } catch {
            // Continue.
          }
        }
        if (resolved) break;
      }
      if (!resolved) {
        unresolved.push({ file: item.file, ref: rawRef });
      }
    }
  }

  const noInboundActive = items
    .filter((item) => {
      const status = (item.status || "").toLowerCase();
      return (
        ACTIVE_STATUSES.has(status) &&
        (inbound.get(item.file)?.length || 0) === 0
      );
    })
    .map((item) => ({
      file: item.file,
      id: item.id,
      status: item.status,
      title: item.title,
    }))
    .sort((a, b) => a.file.localeCompare(b.file));

  const schemaViolations: SchemaViolationFinding[] = [];
  const schemaLoadErrors: SchemaViolationFinding[] = [];
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateSchema: false,
  });
  const validatorCache = new Map<string, ReturnType<Ajv2020["compile"]>>();

  const docSchemaPath = resolveLocalPath(
    options.rootDir,
    "schemas/frontmatter/document/current.json",
  );
  try {
    const docSchema = await loadJson(docSchemaPath);
    ajv.addSchema(docSchema, "/frontmatter/document/1.0.0");
  } catch {
    // Best effort.
  }

  // Pre-load support schemas for work-item validation
  const baseSchemaPath = resolveLocalPath(
    options.rootDir,
    "schemas/frontmatter/support/base/current.json",
  );
  try {
    const baseSchema = await loadJson(baseSchemaPath);
    await addSchemaWithAliases(
      ajv,
      options.rootDir,
      baseSchemaPath,
      baseSchema,
    );
  } catch {
    // Best effort.
  }

  // Pre-load local contract and overlay schemas so Ajv never needs the remote
  // templjs registry for base-schema $ref resolution.
  await preloadSchemaTree(
    ajv,
    options.rootDir,
    "schemas/frontmatter/support/contracts",
  );
  await preloadSchemaTree(
    ajv,
    options.rootDir,
    "schemas/frontmatter/support/overlays",
  );

  async function getValidator(schemaTarget: string) {
    const schemaPath = resolveLocalPath(options.rootDir, schemaTarget);
    if (validatorCache.has(schemaPath)) return validatorCache.get(schemaPath)!;
    const schema = await loadJson(schemaPath);
    const schemaId =
      typeof schema.$id === "string" ? (schema.$id as string) : undefined;
    if (schemaId) {
      const cachedById = ajv.getSchema(schemaId);
      if (cachedById) {
        validatorCache.set(schemaPath, cachedById);
        return cachedById;
      }
    }
    let validator;
    try {
      validator = ajv.compile(schema);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (schemaId && message.includes("already exists")) {
        const cachedById = ajv.getSchema(schemaId);
        if (cachedById) {
          validatorCache.set(schemaPath, cachedById);
          return cachedById;
        }
      }
      throw err;
    }
    validatorCache.set(schemaPath, validator);
    return validator;
  }

  for (const item of items) {
    if (item.parseError) continue;
    if (!item.type) continue;
    const schemaRef = resolveSchema({
      data: {
        type: item.type ?? undefined,
        subtype: item.subtype ?? undefined,
        $schema: typeof item.data.$schema === "string" ? item.data.$schema : undefined,
        schema: typeof item.data.schema === "string" || typeof item.data.schema === "object"
          ? (item.data.schema as string | object)
          : undefined,
        $inlineSchema: typeof item.data.$inlineSchema === "object" && item.data.$inlineSchema !== null
          ? (item.data.$inlineSchema as object)
          : undefined,
      },
      schemaMap,
    });
    if (!schemaRef) continue;
    // Inline schema objects are not yet handled by getValidator (path-based);
    // skip silently and continue to next item.
    if (typeof schemaRef !== "string") continue;
    const schemaTarget = schemaRef;
    if (!schemaTarget) continue;
    try {
      const validate = await getValidator(schemaTarget);
      const ok = validate(item.data);
      if (!ok) {
        schemaViolations.push({
          file: item.file,
          schema: schemaTarget,
          errors: toErrorLines(validate.errors as ErrorObject[]),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Separate schema-load errors from validation errors
      schemaLoadErrors.push({
        file: item.file,
        schema: schemaTarget,
        errors: [`(schema-load) ${message}`],
      });
    }
  }

  const hasErrors =
    unresolved.length > 0 ||
    parseErrors.length > 0 ||
    schemaViolations.length > 0;
  const hasWarnings =
    duplicateIds.length > 0 ||
    noInboundActive.length > 0 ||
    schemaLoadErrors.length > 0;

  const exitCode =
    options.failOn === "warning"
      ? hasErrors || hasWarnings
        ? 1
        : 0
      : hasErrors
      ? 1
      : 0;

  return {
    generated_at: new Date().toISOString(),
    options,
    totals: {
      files: items.length,
      duplicate_ids: duplicateIds.length,
      unresolved_wikilinks: unresolved.length,
      parse_errors: parseErrors.length,
      no_inbound_active: noInboundActive.length,
      schema_violations: schemaViolations.length,
    },
    duplicate_ids: duplicateIds,
    unresolved_wikilinks: unresolved.sort((a, b) =>
      `${a.file}:${a.ref}`.localeCompare(`${b.file}:${b.ref}`),
    ),
    parse_errors: parseErrors.sort((a, b) => a.file.localeCompare(b.file)),
    no_inbound_active: noInboundActive,
    schema_violations: schemaViolations.sort((a, b) =>
      a.file.localeCompare(b.file),
    ),
    schema_load_errors: schemaLoadErrors.sort((a, b) =>
      a.file.localeCompare(b.file),
    ),
    exit_code: exitCode,
  };
}
