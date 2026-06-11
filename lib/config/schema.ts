/**
 * TypeBox schema definitions for .doc.json configuration.
 *
 * Generates valid JSON Schema 2020-12 and TypeScript types via `Static<T>`.
 * All properties include descriptions for self-documentation.
 *
 * @module lib/config/schema
 */

import { Type, type Static } from "@sinclair/typebox";

const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";

// ---------------------------------------------------------------------------
// SchemaMapConfigSchema
// ---------------------------------------------------------------------------

/**
 * Routing rules that map document type/subtype to a JSON Schema path or URI.
 *
 * Priority order:
 *   1. `bySubtype[subtype]` — most specific
 *   2. `byType[type]`        — type-level fallback
 *   3. `default`             — catch-all fallback
 */
export const SchemaMapConfigSchema = Type.Object(
  {
    byType: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description:
          "Map of document type (e.g. 'document', 'work-item') to schema path or URI.",
      }),
    ),
    bySubtype: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description:
          "Map of subtype (e.g. 'epic', 'task') to schema path or URI. Takes precedence over byType.",
      }),
    ),
    default: Type.Optional(
      Type.String({
        description: "Fallback schema path or URI when no type/subtype match.",
      }),
    ),
  },
  {
    $schema: JSON_SCHEMA_2020_12,
    additionalProperties: false,
    description: "Schema routing rules for type/subtype → schema resolution.",
  },
);

export type SchemaMapConfig = Static<typeof SchemaMapConfigSchema>;

// ---------------------------------------------------------------------------
// ValidationConfigSchema
// ---------------------------------------------------------------------------

/**
 * Controls how strictly validation failures are treated.
 */
export const ValidationConfigSchema = Type.Object(
  {
    failOn: Type.Optional(
      Type.Union([Type.Literal("error"), Type.Literal("warning")], {
        description:
          "Minimum severity level that causes validation to exit with a non-zero code.",
      }),
    ),
    allowUnknownProperties: Type.Optional(
      Type.Boolean({
        description:
          "When true, extra frontmatter properties are silently allowed even if the schema disallows them.",
      }),
    ),
  },
  {
    $schema: JSON_SCHEMA_2020_12,
    additionalProperties: false,
    description: "Controls validation strictness and failure thresholds.",
  },
);

export type ValidationConfig = Static<typeof ValidationConfigSchema>;

// ---------------------------------------------------------------------------
// BacklogConfigSchema
// ---------------------------------------------------------------------------

/**
 * Settings that control backlog audit behaviour.
 */
export const BacklogConfigSchema = Type.Object(
  {
    dir: Type.Optional(
      Type.String({
        description: "Directory to scan for backlog work-item files.",
        default: "backlog",
      }),
    ),
    schemaMap: Type.Optional(
      SchemaMapConfigSchema,
    ),
    profiles: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Ordered list of profile names or paths to merge. Earlier entries have higher priority.",
      }),
    ),
  },
  {
    $schema: JSON_SCHEMA_2020_12,
    additionalProperties: false,
    description: "Configuration for the backlog audit and validate commands.",
  },
);

export type BacklogConfig = Static<typeof BacklogConfigSchema>;

// ---------------------------------------------------------------------------
// VocabularyConfigSchema
// ---------------------------------------------------------------------------

/**
 * JSON-LD vocabulary context configuration.
 */
export const VocabularyConfigSchema = Type.Object(
  {
    defaultContext: Type.Optional(
      Type.Union([Type.String(), Type.Record(Type.String(), Type.Unknown())], {
        description:
          "Default @context URI or inline context object applied to all documents unless overridden.",
      }),
    ),
    contexts: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Union([
          Type.String(),
          Type.Record(Type.String(), Type.Unknown()),
        ]),
        {
          description:
            "Per-type or per-subtype context overrides. Key is 'type' or 'type/subtype'.",
        },
      ),
    ),
  },
  {
    $schema: JSON_SCHEMA_2020_12,
    additionalProperties: false,
    description: "JSON-LD vocabulary context settings for semantic enrichment.",
  },
);

export type VocabularyConfig = Static<typeof VocabularyConfigSchema>;

// ---------------------------------------------------------------------------
// DocVaderConfigSchema  (main config, supports extends)
// ---------------------------------------------------------------------------

/**
 * Root configuration schema for .doc.json.
 *
 * Supports `extends` (single string or array) for composition / inheritance.
 */
export const DocVaderConfigSchema = Type.Object(
  {
    $schema: Type.Optional(
      Type.String({
        description:
          "Optional JSON Schema URI identifying the config schema used to validate this file.",
      }),
    ),
    extends: Type.Optional(
      Type.Union([Type.String(), Type.Array(Type.String())], {
        description:
          "One or more base configuration files or npm package names to extend. " +
          "Resolved in order; later entries override earlier ones; the local config overrides all.",
      }),
    ),
    schemaMap: Type.Optional(SchemaMapConfigSchema),
    validation: Type.Optional(ValidationConfigSchema),
    backlog: Type.Optional(BacklogConfigSchema),
    vocabularies: Type.Optional(VocabularyConfigSchema),
  },
  {
    $schema: JSON_SCHEMA_2020_12,
    additionalProperties: false,
    description:
      "Root .doc.json configuration. Supports composition via extends.",
  },
);

export type DocVaderConfig = Static<typeof DocVaderConfigSchema>;
