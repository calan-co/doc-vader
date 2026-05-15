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

import { lintRule } from "unified-lint-rule";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import matter from "gray-matter";
import type { Plugin } from "unified";
import type { Root } from "mdast";

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

const validationCache = new Map<string, CacheEntry>();

// Cache Ajv instances (one per resolved schema directory) so support schemas
// are only loaded once and compiled validators are reused.
const ajvInstanceCache = new Map<string, InstanceType<typeof Ajv2020>>();

// Only allow safe, non-traversing name segments for schema type resolution.
const SAFE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

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
          if (schema?.$id && !ajv.getSchema(schema.$id)) {
            ajv.addSchema(schema, schema.$id);
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
): Promise<any> {
  if (type !== null) {
    if (!SAFE_NAME_RE.test(type)) {
      throw new Error(
        `Invalid frontmatter type "${type}": only alphanumeric characters, hyphens, and underscores are allowed`,
      );
    }
    const typedPath = path.join(schemaDir, "by-type", type, "latest.json");
    const schema = await loadSchemaFile(typedPath);
    if (schema) return schema;
  }
  const defaultPath = path.join(schemaDir, "default.json");
  return await loadSchemaFile(defaultPath);
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
  // Check mtime-keyed cache.
  let cacheKey: string | undefined;
  try {
    const stat = await fs.stat(filePath);
    cacheKey = `${filePath}:${stat.mtime.getTime()}`;
    if (validationCache.has(cacheKey)) {
      return validationCache.get(cacheKey)!.errors;
    }
  } catch {
    // In-memory VFiles have no on-disk path; skip caching.
  }

  const type = typeof frontmatter.type === "string" ? frontmatter.type : null;
  const schema = await resolveSchema(type, schemaDir);
  if (!schema) return null;

  const ajv = await getAjv(schemaDir);
  const validate = ajv.compile(schema);
  const valid = validate(frontmatter);

  const errors: ValidationError[] | null =
    !valid && validate.errors
      ? validate.errors.map((err) => ({
          path: err.instancePath || "(root)",
          message: err.message ?? "unknown error",
          keyword: err.keyword,
        }))
      : null;

  // Populate the cache now that we have a result.
  if (cacheKey !== undefined) {
    validationCache.set(cacheKey, { timestamp: Date.now(), errors });
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
    try {
      const parsed = matter(rawContent);
      frontmatter = parsed.data as Record<string, unknown>;
    } catch {
      file.message("[frontmatter-schema] Failed to parse frontmatter YAML");
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
      file.message(`[frontmatter-schema] Validation error: ${reason}`);
      return;
    }

    if (!errors || errors.length === 0) return;

    for (const error of errors) {
      const msg = `[frontmatter-schema] ${error.path}: ${error.message}`;
      file.message(msg, { source: "remark-lint:frontmatter-schema" });
    }
  },
) as unknown as Plugin<[(Readonly<Options> | null | undefined)?], string, Root>;

export default remarkFrontmatterSchema;
