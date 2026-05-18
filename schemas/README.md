# Schemas

This directory contains JSON Schema definitions used by doc-vader to validate
document and work-item frontmatter.  All schemas are written for
**JSON Schema draft-2020-12** and validated with [Ajv 8](https://ajv.js.org/).

---

## Directory structure

```
schemas/
├── frontmatter/
│   ├── document/          # Canonical document frontmatter schema
│   ├── work-item/         # Canonical work-item frontmatter schema
│   ├── by-type/           # Convenience aliases (document, work-item)
│   ├── support/           # Shared sub-schemas
│   │   ├── base/          # Base schema (common required fields)
│   │   ├── contracts/     # Token-level enum contracts
│   │   ├── overlays/      # Vocabulary overlays (human-readable labels)
│   │   └── payloads/      # Structured payload schemas (e.g. status transitions)
│   └── schema-map.json    # Default schema-routing table
└── work-management/       # Content and frontmatter schemas for work-mgmt docs
    ├── content/
    ├── frontmatter/
    └── support/
```

---

## Versioning and `$id` conventions

Each schema carries a `$id` value that doubles as its stable URI.

| Pattern | Example |
|---|---|
| `/frontmatter/{type}/{version}` | `/frontmatter/document/1.0.0` |
| `/frontmatter/{type}/{version}` | `/frontmatter/work-item/1.0.0` |

**Version files** (`1.0.0.json`, `1.1.0.json`, …) are immutable once published —
only append new versions.

**Pointer files** are updated in place to track the recommended version:

| Filename | Meaning |
|---|---|
| `current.json` | Actively maintained; safe to reference in CI |
| `latest.json` | Identical to `current.json`; kept for ecosystem compatibility |

Tooling in this repository always references `current.json` for schema
resolution at run-time.  The `$id` inside `current.json` points to the
underlying versioned schema (`/frontmatter/document/1.0.0`).

---

## Schema-map routing

The `schemas/frontmatter/schema-map.json` file describes the default routing
table used when no `$schema` field is present in a document's frontmatter:

```json
{
  "default": "schemas/frontmatter/document/current.json",
  "byType": {
    "document":  "schemas/frontmatter/document/current.json",
    "work-item": "schemas/frontmatter/work-item/current.json"
  }
}
```

The same table can be overridden per-project in `.doc.json`:

```json
{
  "schemaMap": {
    "byType": { "adr": "schemas/frontmatter/adr/current.json" }
  }
}
```

The runtime resolution order is (highest priority first):

1. **Inline schema** — `$inlineSchema` or `schema` field is an object
2. **Embedded ref** — `$schema` or `schema` field is a URI string
3. **Property-based routing** — `schemaMap.bySubtype[subtype]` → `schemaMap.byType[type]`
4. **Default** — `schemaMap.default`

This logic lives in [`lib/schema/resolver.ts`](../lib/schema/resolver.ts).

---

## Support schemas

### `support/base/`

Provides the minimum required fields (`id`, `title`, `type`, `status`) that
every document and work-item must satisfy.  Referenced by `$ref` from the
document and work-item canonical schemas.

### `support/contracts/`

Token-level enum definitions used to constrain specific frontmatter fields.
Each contract file names exactly one enum (e.g. `audience-token`,
`classification-token`).  Contract files are immutable; update by creating
a new contract file.

### `support/overlays/`

Vocabulary overlays that extend contract tokens with human-readable labels
(`title`, `description`).  Overlays are additive — they never restrict values
defined by the underlying contract.

### `support/payloads/`

Structured payload schemas for complex field values, such as the
`status-transition-payload` used in governance workflows.

---

## Work-management schemas

The `schemas/work-management/` subtree contains schemas for higher-level
work-management documents (milestones, plans, projects, releases, records,
and work items) that are distinct from the low-level frontmatter schemas.

---

## Adding a new schema

1. Create a versioned file: `schemas/frontmatter/<type>/<semver>.json`
2. Set `"$schema": "https://json-schema.org/draft/2020-12/schema"` and a
   `$id` matching the path above.
3. Copy or symlink the file to `current.json` (and `latest.json` if needed).
4. Register the type in `schemas/frontmatter/schema-map.json` under `byType`.
5. Add a validation fixture under `tests/fixtures/` and extend the test suite.

---

## References

- [JSON Schema draft-2020-12](https://json-schema.org/draft/2020-12/release-notes)
- [Ajv 8 documentation](https://ajv.js.org/)
- [lib/schema/resolver.ts](../lib/schema/resolver.ts) — DRY schema routing logic
- [lib/config/schema.ts](../lib/config/schema.ts) — TypeBox config schema
