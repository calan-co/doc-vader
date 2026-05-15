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
 *   strict?: boolean;
 *   schemaDir?: string;
 * }
 * ```
 *
 * ###### Fields
 *
 * * `enabled` (`boolean`, optional, default: true)
 *   — whether to enable this plugin
 * * `strict` (`boolean`, optional, default: false)
 *   — whether to treat validation errors as errors (true) or messages (false)
 * * `schemaDir` (`string`, optional, default: 'schemas')
 *   — directory containing JSON schema files
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
import Ajv from "ajv/dist/2020.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Plugin } from "unified";
import type { Root } from "mdast";

export const optionsSchema = z.object({
  enabled: z.boolean().optional().default(true),
  strict: z.boolean().optional().default(false),
  schemaDir: z.string().optional().default("schemas"),
});

export type Options = z.input<typeof optionsSchema>;

interface CacheEntry {
  timestamp: number;
  errors: any[] | null;
}

const validationCache = new Map<string, CacheEntry>();

async function loadSchema(schemaPath: string): Promise<any> {
  try {
    const content = await fs.readFile(schemaPath, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function getSchemaForFile(
  type: string | null,
  schemaDir: string,
): Promise<any> {
  // Try type-specific schema first
  if (type) {
    const typeSchemaPath = path.join(schemaDir, `${type}.json`);
    const schema = await loadSchema(typeSchemaPath);
    if (schema) return schema;
  }

  // Try default schema
  const defaultSchemaPath = path.join(schemaDir, "default.json");
  return await loadSchema(defaultSchemaPath);
}

async function validateFrontmatter(
  filePath: string,
  frontmatter: Record<string, unknown>,
  options: Options,
): Promise<any[] | null> {
  const rootDir = process.cwd();
  const schemaDir = path.resolve(rootDir, options.schemaDir || "schemas");
  const type = (frontmatter.type as string) || null;

  // Check cache based on file mtime
  try {
    const stat = await fs.stat(filePath);
    const cacheKey = `${filePath}:${stat.mtime.getTime()}`;
    if (validationCache.has(cacheKey)) {
      return validationCache.get(cacheKey)!.errors;
    }
  } catch {
    // File may not exist or be readable; continue without cache
  }

  const schema = await getSchemaForFile(type, schemaDir);
  if (!schema) {
    return null;
  }

  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  const valid = validate(frontmatter);

  if (!valid && validate.errors) {
    return validate.errors.map((err) => ({
      path: err.instancePath || "(root)",
      message: err.message,
      keyword: err.keyword,
    }));
  }

  return null;
}

const remarkFrontmatterSchema = lintRule(
  {
    origin: "remark-lint:frontmatter-schema",
    url: "https://github.com/remarkjs/remark-lint",
  },
  function (tree: any, file: any, options?: Options) {
    if (options === undefined) return;

    let parsedOptions: Options;
    try {
      parsedOptions = optionsSchema.parse(options);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      file.message(`Invalid frontmatter-schema options: ${reason}`);
      return;
    }

    if (!parsedOptions.enabled) return;

    // Extract frontmatter from file data (populated by plugins)
    const frontmatter = (file.data?.frontmatter || {}) as Record<
      string,
      unknown
    >;
    if (Object.keys(frontmatter).length === 0) return;

    // Validate frontmatter
    const filePath = file.path || (file.history && file.history[0]);
    if (!filePath) return;

    // Run async validation synchronously where possible (cache hits)
    // Note: For initial implementation, we'll just report missing schema gracefully
    validateFrontmatter(filePath, frontmatter, parsedOptions).then((errors) => {
      if (errors && errors.length > 0) {
        errors.forEach((error) => {
          const message = `[frontmatter-schema] ${error.path}: ${error.message}`;
          file.message(message, {
            source: "remark-lint:frontmatter-schema",
          });
        });
      }
    });
  },
) as unknown as Plugin<[(Readonly<Options> | null | undefined)?], string, Root>;

export default remarkFrontmatterSchema;
