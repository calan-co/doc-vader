/**
 * Configuration loader for .doc.json files.
 *
 * Features:
 * - Validates loaded config against the TypeBox-derived JSON Schema
 * - Resolves `extends` chains recursively (circular-dependency guard)
 * - Supports relative paths and npm package refs
 * - Deep-merges base configs with local overrides applied last
 *
 * @module lib/config/loader
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname, isAbsolute } from "node:path";
import { createRequire } from "node:module";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { type DocVaderConfig, DocVaderConfigSchema } from "./schema.js";

// ---------------------------------------------------------------------------
// Ajv instance — shared, compiled once
// ---------------------------------------------------------------------------

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// The TypeBox schema produces standard JSON Schema, so we can validate
// the raw parsed config with it before casting.
const _validateConfig = ajv.compile(DocVaderConfigSchema);

// ---------------------------------------------------------------------------
// Deep merge helper
// ---------------------------------------------------------------------------

type PlainObject = Record<string, unknown>;

function isPlainObject(val: unknown): val is PlainObject {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

/**
 * Deep-merge `source` into `target`.  Arrays are replaced (not concatenated)
 * to match the "last writer wins" semantic expected for config inheritance.
 */
function deepMerge(target: PlainObject, source: PlainObject): PlainObject {
  const result: PlainObject = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key] as PlainObject, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Path resolution helpers
// ---------------------------------------------------------------------------

const _require = createRequire(import.meta.url);

/**
 * Resolve an extends reference to an absolute filesystem path.
 *
 * Handles:
 *   - Absolute paths       → used as-is
 *   - Relative paths       → resolved relative to `baseDir`
 *   - npm packages         → resolved via Node's require resolution from `baseDir`
 *     (e.g. `"@scope/package"` → `<node_modules>/@scope/package/doc.json`)
 */
function resolveExtendsPath(ref: string, baseDir: string): string {
  if (isAbsolute(ref)) return ref;

  // Relative path
  if (ref.startsWith(".")) {
    return resolve(baseDir, ref);
  }

  // npm package reference — try to require-resolve the main entry
  try {
    return _require.resolve(ref, { paths: [baseDir] });
  } catch {
    // Fall back to treating it as a relative path if resolution fails
    return resolve(baseDir, ref);
  }
}

// ---------------------------------------------------------------------------
// ConfigLoader
// ---------------------------------------------------------------------------

export interface LoadConfigOptions {
  /** Absolute path to the .doc.json to load. */
  configPath: string;
}

export class ConfigLoader {
  /**
   * Load and validate a .doc.json file, resolving any `extends` chain.
   *
   * @throws {Error} if the file cannot be read or fails schema validation.
   */
  async load(options: LoadConfigOptions): Promise<DocVaderConfig> {
    const seen = new Set<string>();
    return this._load(options.configPath, seen);
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async _load(
    configPath: string,
    seen: Set<string>,
  ): Promise<DocVaderConfig> {
    const abs = resolve(configPath);

    if (seen.has(abs)) {
      throw new Error(
        `Circular extends detected: "${abs}" has already been loaded in this chain.\n` +
          `Chain so far: ${[...seen].join(" → ")}`,
      );
    }
    seen.add(abs);

    // 1. Read and parse raw JSON
    const raw = await readFile(abs, "utf-8").catch((err: unknown) => {
      throw new Error(
        `Cannot read config file "${abs}": ${(err as Error).message}`,
      );
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `Invalid JSON in config file "${abs}": ${(err as Error).message}`,
      );
    }

    // 2. Validate against schema
    if (!_validateConfig(parsed)) {
      const errors = (_validateConfig.errors ?? [])
        .map((e) => `  ${e.instancePath || "(root)"} ${e.message}`)
        .join("\n");
      throw new Error(
        `Config file "${abs}" failed schema validation:\n${errors}`,
      );
    }

    const local = parsed as DocVaderConfig;
    const baseDir = dirname(abs);

    // 3. Resolve extends (if present)
    if (!local.extends) {
      seen.delete(abs); // allow the same base to be used by multiple configs
      return local;
    }

    const extendsRefs = Array.isArray(local.extends)
      ? local.extends
      : [local.extends];

    // Start from an empty object and merge bases left-to-right
    let merged: PlainObject = {};

    for (const ref of extendsRefs) {
      const resolvedPath = resolveExtendsPath(ref, baseDir);
      const base = await this._load(resolvedPath, new Set(seen)); // new Set clones; circular detection still works per-path
      merged = deepMerge(merged, base as PlainObject);
    }

    // Local config overrides merged bases (omit the `extends` key itself)
    const { extends: _ext, ...localWithoutExtends } = local;
    merged = deepMerge(merged, localWithoutExtends as PlainObject);

    seen.delete(abs);
    return merged as DocVaderConfig;
  }
}

// ---------------------------------------------------------------------------
// Convenience function
// ---------------------------------------------------------------------------

/**
 * Convenience function: load a .doc.json config from a given path.
 *
 * @example
 * ```ts
 * const config = await loadDocVaderConfig('.doc.json');
 * ```
 */
export async function loadDocVaderConfig(
  configPath: string,
): Promise<DocVaderConfig> {
  const loader = new ConfigLoader();
  return loader.load({ configPath });
}
