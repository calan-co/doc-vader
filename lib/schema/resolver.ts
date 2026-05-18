/**
 * DRY schema resolver.
 *
 * Centralises the 4-level precedence lookup that determines which JSON Schema
 * to validate a document or work-item against.
 *
 * Precedence (highest → lowest):
 *   1. Inline schema   — `data.$inlineSchema` or `data.schema` is an object
 *   2. Embedded ref    — `data.$schema` or `data.schema` is a string URI/path
 *   3. Property-based  — `schemaMap.bySubtype[subtype]` or `schemaMap.byType[type]`
 *   4. User default    — `schemaMap.default`
 *
 * Returns `null` when no schema can be resolved (caller decides whether to
 * skip or emit a warning).
 *
 * @module lib/schema/resolver
 */

import type { SchemaMapConfig, VocabularyConfig } from "../config/schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal view of a document/work-item needed for schema resolution.
 * Only the fields consulted by the resolver are required; the rest are optional.
 */
export interface ResolvableData {
  /** Top-level document type (e.g. `"document"`, `"work-item"`). */
  type?: string;
  /** Subtype within the document type (e.g. `"epic"`, `"task"`). */
  subtype?: string;
  /** Inline schema object embedded in the data. */
  $inlineSchema?: object;
  /** Schema reference string or inline object (gray-matter / JSON-LD field). */
  schema?: string | object;
  /** Standard `$schema` keyword — a URI string. */
  $schema?: string;
  /** JSON-LD `@context` — overrides vocabulary default when present. */
  "@context"?: string | object;
}

export interface ResolveSchemaOptions {
  /** The parsed frontmatter / data to resolve a schema for. */
  data: ResolvableData;
  /** Schema routing rules (optional — falls back to null when omitted). */
  schemaMap?: SchemaMapConfig;
}

export interface ResolveVocabularyOptions {
  /** The parsed frontmatter / data to resolve a context for. */
  data: ResolvableData;
  /** Vocabulary configuration containing defaultContext and per-type overrides. */
  vocabulary?: VocabularyConfig;
}

/** The result of schema resolution: a URI string, inline schema object, or null. */
export type SchemaRef = string | object | null;

// ---------------------------------------------------------------------------
// resolveSchema
// ---------------------------------------------------------------------------

/**
 * Resolve the schema reference for a document.
 *
 * Returns the first matching result across the 4-level precedence chain, or
 * `null` if no schema can be determined.
 *
 * @example
 * ```ts
 * const ref = resolveSchema({
 *   data: { type: 'work-item', subtype: 'epic' },
 *   schemaMap: { bySubtype: { epic: '/schemas/epic.json' } },
 * });
 * // → '/schemas/epic.json'
 * ```
 */
export function resolveSchema(options: ResolveSchemaOptions): SchemaRef {
  const { data, schemaMap } = options;

  // Level 1 — Inline schema object
  if (data.$inlineSchema && typeof data.$inlineSchema === "object") {
    return data.$inlineSchema;
  }
  if (data.schema && typeof data.schema === "object") {
    return data.schema;
  }

  // Level 2 — Embedded ref (string)
  if (data.$schema && typeof data.$schema === "string") {
    return data.$schema;
  }
  if (data.schema && typeof data.schema === "string") {
    return data.schema;
  }

  if (!schemaMap) return null;

  // Level 3 — Property-based routing via schemaMap
  if (data.subtype && schemaMap.bySubtype?.[data.subtype]) {
    return schemaMap.bySubtype[data.subtype];
  }
  if (data.type && schemaMap.byType?.[data.type]) {
    return schemaMap.byType[data.type];
  }

  // Level 4 — Default fallback
  if (schemaMap.default) {
    return schemaMap.default;
  }

  return null;
}

// ---------------------------------------------------------------------------
// resolveVocabularyContext
// ---------------------------------------------------------------------------

/**
 * Resolve the JSON-LD `@context` for a document.
 *
 * Precedence:
 *   1. Inline `@context` in the document data
 *   2. Per-type/subtype context from `vocabulary.contexts`
 *   3. Global `vocabulary.defaultContext`
 *   4. `null` (no context defined)
 *
 * @example
 * ```ts
 * const ctx = resolveVocabularyContext({
 *   data: { type: 'document', '@context': 'https://schema.org' },
 *   vocabulary: { defaultContext: 'https://example.com/base-context.json' },
 * });
 * // → 'https://schema.org'  (inline takes precedence)
 * ```
 */
export function resolveVocabularyContext(
  options: ResolveVocabularyOptions,
): string | object | null {
  const { data, vocabulary } = options;

  // Level 1 — Inline @context in data
  if (data["@context"] !== undefined) {
    return data["@context"];
  }

  if (!vocabulary) return null;

  // Level 2 — Per-type/subtype override
  if (vocabulary.contexts) {
    // Most-specific first: type/subtype key
    if (data.type && data.subtype) {
      const key = `${data.type}/${data.subtype}`;
      if (vocabulary.contexts[key] !== undefined) {
        return vocabulary.contexts[key];
      }
    }
    // Type-only key
    if (data.type && vocabulary.contexts[data.type] !== undefined) {
      return vocabulary.contexts[data.type];
    }
  }

  // Level 3 — Global default
  if (vocabulary.defaultContext !== undefined) {
    return vocabulary.defaultContext;
  }

  return null;
}
