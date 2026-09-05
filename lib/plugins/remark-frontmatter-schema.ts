// #region
/**
 * ## What is this?
 *
 * `remark-frontmatter-schema` validates frontmatter against JSON schemas using Ajv.
 *
 * ## API
 *
 * ### `unified().use(remarkFrontmatterSchema[, options])`
 *
 * Validate frontmatter against configured schemas.
 *
 * ###### Parameters
 *
 * * `options` ([`Options`](#options), optional)
 *   — configuration object for schema validation
 *
 * ###### Returns
 *
 * Transform ([`Transformer` from `unified`](https://github.com/unifiedjs/unified#transformer)).
 *
 * ### `Options`
 *
 * Configuration (TypeScript type).
 *
 * ###### Type
 *
 * ```ts
 * export interface Options {
 *   enabled?: boolean;
 *   schemaDir?: string;
 * }
 * ```
 *
 * ###### Fields
 *
 * * `enabled` (`boolean`, optional, default: true)
 *   — whether to enable this plugin
 * * `schemaDir` (`string`, optional, default: 'schemas/frontmatter')
 *   — directory containing JSON schema files; schemas are resolved at
 *     `{schemaDir}/by-type/{type}/latest.json`
 *
 * ## Recommendation
 *
 * Use this rule to enforce consistent frontmatter structure and types across markdown documents.
 *
 * ## Fix
 *
 * Update frontmatter fields to match the required schema. Check the validation messages for specific issues.
 *
 * #endregion
 */

import { lintRule, type Label, type Severity } from "unified-lint-rule";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import matter from "gray-matter";
import type { Root } from "mdast";
import type { Plugin as LintRulePlugin } from "unified-lint-rule";

export const optionsSchema = z.object({
  enabled: z.boolean().optional().default(true),
  schemaDir: z.string().optional().default("schemas/frontmatter"),
});

export type Options = z.input<typeof optionsSchema>;

interface ValidationError {
  path: string;
  message: string;
  keyword: string;
}

interface CacheEntry {
  timestamp: number;
  errors: ValidationError[] | null;
}

interface ResolvedSchema {
  schema: any;
  cacheKey: string;
}

type MessagePosition = {
  line: number;
  column: number;
};

type FrontmatterSchemaConfig =
  | Readonly<Options>
  | Severity
  | Label
  | boolean
  | [level: Label | Severity | boolean, option?: Readonly<Options>];

const validationCache = new Map<string, CacheEntry>();

// Cache compiled validators by schema path + mtime so schema compilation is
// skipped until the underlying schema file changes.
const compiledSchemaCache = new Map<string, any>();

// Cache Ajv instances (one per resolved schema directory) so support schemas
// are only loaded once and compiled validators are reused.
const ajvInstanceCache = new Map<string, InstanceType<typeof Ajv2020>>();

// Only allow safe, non-traversing name segments for schema type resolution.
const SAFE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveFrontmatterPosition(
  frontmatterBlock: string | undefined,
  instancePath: string | undefined,
): MessagePosition {
  const frontmatterText =
    typeof frontmatterBlock === "string"
      ? frontmatterBlock.replace(/^\r?\n/, "")
      : "";
  const frontmatterLines = frontmatterText.split(/\r?\n/);
  const rootPosition = { line: 2, column: 1 };
  const pathSegments = String(instancePath ?? "")
    .split("/")
    .filter(Boolean)
    .filter((segment) => !/^\d+$/.test(segment));

  if (pathSegments.length === 0) {
    return rootPosition;
  }

  let nextSearchLine = 0;
  let resolvedPosition: MessagePosition | null = null;

  for (const segment of pathSegments) {
    const segmentPattern = new RegExp(
      `^(\\s*)['"]?${escapeRegExp(segment)}['"]?\\s*:`,
    );
    let segmentFound = false;

    for (
      let lineIndex = nextSearchLine;
      lineIndex < frontmatterLines.length;
      lineIndex++
    ) {
      const match = frontmatterLines[lineIndex].match(segmentPattern);
      if (!match) continue;

      resolvedPosition = {
        line: 2 + lineIndex,
        column: match[1].length + 1,
      };
      nextSearchLine = lineIndex + 1;
      segmentFound = true;
      break;
    }

    if (!segmentFound) break;
  }

  return resolvedPosition ?? rootPosition;
}

function schemaContainsRemoteRef(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(schemaContainsRemoteRef);
  }

  if (typeof value === "object" && value !== null) {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, nested]) =>
        (key === "$ref" &&
          typeof nested === "string" &&
          /^https?:\/\//i.test(nested)) ||
        schemaContainsRemoteRef(nested),
    );
  }

  return false;
}

/**
 * Load a JSON file from disk.
 * Returns `null` when the file does not exist (ENOENT).
 * Re-throws for permission errors, JSON parse errors, and other I/O failures
 * so that broken schemas surface rather than silently disabling validation.
 */
async function loadSchemaFile(schemaPath: string): Promise<any> {
  let content: string;
  try {
    content = await fs.readFile(schemaPath, "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
  return JSON.parse(content);
}

/**
 * Recursively walk `supportDir` and register every JSON schema found under
 * its own `$id` so that Ajv can resolve external `$ref`s without network
 * access.
 */
async function preloadSupportSchemas(
  ajv: InstanceType<typeof Ajv2020>,
  supportDir: string,
): Promise<void> {
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // Support dir may not exist; that's fine.
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        try {
          const schema = await loadSchemaFile(fullPath);
          const schemaId = typeof schema?.$id === "string" ? schema.$id : undefined;
          if (!schemaId) continue;
          if (!ajv.getSchema(schemaId)) {
            ajv.addSchema(schema, schemaId);
          }
          const relativePath = path
            .relative(supportDir, fullPath)
            .replace(/\.json$/u, "")
            .split(path.sep)
            .join("/");
          const supportMarker = "/support/";
          const supportIndex = schemaId.indexOf(supportMarker);
          if (supportIndex >= 0) {
            const alias = `${schemaId.slice(0, supportIndex + supportMarker.length - 1)}/${relativePath}`;
            if (!ajv.getSchema(alias)) {
              ajv.addSchema({ ...schema, $id: alias }, alias);
            }
          }
        } catch {
          // Best effort — a broken support schema should not halt all validation.
        }
      }
    }
  }
  await walk(supportDir);
}

/**
 * Return (or lazily create) a configured Ajv 2020 instance for `schemaDir`.
 * The instance has formats registered and all support schemas preloaded so
 * external `$ref`s resolve locally.
 */
async function getAjv(
  schemaDir: string,
): Promise<InstanceType<typeof Ajv2020>> {
  if (ajvInstanceCache.has(schemaDir)) {
    return ajvInstanceCache.get(schemaDir)!;
  }
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateSchema: false,
  });
  addFormats(ajv);
  await preloadSupportSchemas(ajv, path.join(schemaDir, "support"));
  ajvInstanceCache.set(schemaDir, ajv);
  return ajv;
}

/**
 * Resolve the schema for a given `type` value.
 * Layout: `{schemaDir}/by-type/{type}/latest.json`.
 * Falls back to `{schemaDir}/default.json` when no type-specific schema is
 * found.  Returns `null` when neither exists.
 * Throws when `type` contains path-traversal characters.
 */
async function resolveSchema(
  type: string | null,
  schemaDir: string,
): Promise<ResolvedSchema | null> {
  async function loadResolved(schemaPath: string): Promise<ResolvedSchema | null> {
    const schema = await loadSchemaFile(schemaPath);
    if (!schema) return null;
    const stat = await fs.stat(schemaPath);
    return {
      schema,
      cacheKey: `${schemaPath}:${stat.mtime.getTime()}`,
    };
  }

  if (type !== null) {
    if (!SAFE_NAME_RE.test(type)) {
      throw new Error(
        `Invalid frontmatter type "${type}": only alphanumeric characters, hyphens, and underscores are allowed`,
      );
    }
    const typedPath = path.join(schemaDir, "by-type", type, "latest.json");
    const resolved = await loadResolved(typedPath);
    if (resolved) return resolved;
  }
  const defaultPath = path.join(schemaDir, "default.json");
  return await loadResolved(defaultPath);
}

/**
 * Validate `frontmatter` against the appropriate schema for its `type`.
 * Returns an array of `ValidationError` objects on failure, or `null` when
 * validation passes or no schema is found.
 * Results are memoised by `filePath` + mtime.
 */
async function runValidation(
  filePath: string,
  frontmatter: Record<string, unknown>,
  schemaDir: string,
): Promise<ValidationError[] | null> {
  const type = typeof frontmatter.type === "string" ? frontmatter.type : null;
  const resolvedSchema = await resolveSchema(type, schemaDir);
  if (!resolvedSchema) return null;

  // Check the validation-result cache after schema resolution so schema
  // updates invalidate cached file results as well as compiled validators.
  const schemaCacheKey = resolvedSchema.cacheKey;
  let validationCacheKey: string | undefined;
  try {
    const stat = await fs.stat(filePath);
    validationCacheKey = `${filePath}:${stat.mtime.getTime()}:${schemaCacheKey}`;
    if (validationCache.has(validationCacheKey)) {
      return validationCache.get(validationCacheKey)!.errors;
    }
  } catch {
    // In-memory VFiles have no on-disk path; skip caching.
  }

  const ajv = await getAjv(schemaDir);
  const validatorCacheKey = `${schemaDir}:${resolvedSchema.cacheKey}`;
  let validate = compiledSchemaCache.get(validatorCacheKey);
  if (!validate) {
    validate = ajv.compile(resolvedSchema.schema);
    compiledSchemaCache.set(validatorCacheKey, validate);
  }
  const valid = validate(frontmatter);

  const errors: ValidationError[] | null =
    !valid && validate.errors
      ? validate.errors.map((err: any) => ({
          path: err.instancePath || "(root)",
          message:
            err.keyword === "unevaluatedProperties" &&
            schemaContainsRemoteRef(resolvedSchema.schema) &&
            (String(err.schemaPath ?? "").includes("$ref") ||
              /ref(erence)?/i.test(String(err.message ?? "")))
              ? "can't resolve reference"
              : err.message ?? "unknown error",
          keyword: err.keyword,
        }))
      : null;

  // Populate the cache now that we have a result.
  if (validationCacheKey !== undefined) {
    validationCache.set(validationCacheKey, { timestamp: Date.now(), errors });
  }

  return errors;
}

const remarkFrontmatterSchema = lintRule(
  {
    origin: "remark-lint:frontmatter-schema",
    url: "https://github.com/remarkjs/remark-lint",
  },
  async function (tree: any, file: any, options?: Options) {
    // Apply defaults when options is omitted so `unified().use(plugin)` works.
    let parsedOptions: z.output<typeof optionsSchema>;
    try {
      parsedOptions = optionsSchema.parse(options ?? {});
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      file.message(`Invalid frontmatter-schema options: ${reason}`);
      return;
    }

    if (!parsedOptions.enabled) return;

    // Parse frontmatter directly from the file's raw content so the plugin is
    // self-contained and does not depend on other pipeline members populating
    // `file.data.frontmatter`.
    const rawContent = String(file.value ?? "");
    if (!rawContent.trimStart().startsWith("---")) return;

    let frontmatter: Record<string, unknown>;
    let frontmatterBlock = "";
    try {
      const parsed = matter(rawContent);
      frontmatter = parsed.data as Record<string, unknown>;
      frontmatterBlock =
        rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ??
        parsed.matter ??
        "";
    } catch {
      file.message("[frontmatter-schema] Failed to parse frontmatter YAML", {
        place: { line: 2, column: 1 },
        source: "remark-lint:frontmatter-schema",
      });
      return;
    }

    if (Object.keys(frontmatter).length === 0) return;

    const filePath = file.path ?? file.history?.[0] ?? "";
    const schemaDir = path.resolve(process.cwd(), parsedOptions.schemaDir);

    let errors: ValidationError[] | null;
    try {
      errors = await runValidation(filePath, frontmatter, schemaDir);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      file.message(`[frontmatter-schema] Validation error: ${reason}`, {
        place: { line: 2, column: 1 },
        source: "remark-lint:frontmatter-schema",
      });
      return;
    }

    if (!errors || errors.length === 0) return;

    for (const error of errors) {
      const msg = `[frontmatter-schema] ${error.path}: ${error.message}`;
      file.message(msg, {
        source: "remark-lint:frontmatter-schema",
        place: resolveFrontmatterPosition(frontmatterBlock, error.path),
      });
    }
  },
) as unknown as LintRulePlugin<Root, Readonly<Options>>;

export default remarkFrontmatterSchema;
