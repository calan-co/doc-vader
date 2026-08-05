# Schemas

This directory contains JSON Schema definitions used by doc-vader to validate
canonical metadata, document content, configuration, and compatibility
frontmatter. All schemas are written for **JSON Schema draft-2020-12** and
validated with [Ajv 8](https://ajv.js.org/).

---

## Directory structure

```text
schemas/
├── metadata/              # Canonical metadata contracts used for routing
│   └── base.json          # namespace + type + optional subtype
├── doc-vader/             # Doc-Vader config and document-pack manifests
│   ├── config.json
│   └── document-type-pack.json
├── frontmatter/           # Markdown-frontmatter compatibility schemas
│   ├── document/
│   ├── work-item/
│   ├── by-type/
│   ├── support/
│   └── schema-map.json
└── work-management/       # Content and metadata/frontmatter schemas for work-mgmt docs
    ├── content/
    ├── frontmatter/
    └── support/
```

---

## Versioning and `$id` conventions

Each schema carries a `$id` value that doubles as its stable URI.

The repository uses extensionless schema IDs. The `.json` suffix belongs to the
on-disk filename, not the schema identity.

| Pattern | Example |
| --- | --- |
| `/frontmatter/{type}/{version}` | `/frontmatter/document/1.0.0` |
| `/frontmatter/{type}/{version}` | `/frontmatter/work-item/1.0.0` |

**Version files** (`1.0.0.json`, `1.1.0.json`, …) are immutable once published —
only append new versions.

**Pointer files** are updated in place to track the recommended version:

| Filename | Meaning |
| --- | --- |
| `current.json` | Actively maintained draft pointer; `$id` ends in `/current` |
| `latest.json` | Rolling compatibility pointer; `$id` ends in `/latest` |

Tooling in this repository uses the pointer files for authoring and routing,
but stable schema identity stays extensionless. Published or finalized
references should target versioned `$id`s, not `current` pointers.

When a schema needs a GitHub-hosted URI, the namespace uses this repository,
not the old templjs repository.

---

## Metadata routing

Doc-Vader routes documents by canonical metadata, not by Markdown frontmatter.
The minimal metadata contract is `schemas/metadata/base.json`:

```yaml
namespace: doc-vader.work-management
type: work-item
subtype: task # optional
```

`namespace` and `type` are required in canonical metadata. `subtype` is optional
and should be used only for natural variants within a type. The route key is
`namespace:type[:subtype]`.

Routing precedence is:

1. Explicit document metadata.
2. Explicit `$schema` resolved through the schema or document-pack registry.
3. Merged nearest `dv.yaml` defaults.
4. Unsupported-document diagnostic.

`frontmatter` remains a Markdown serialization and compatibility term. Markdown
format adapters parse YAML frontmatter into canonical metadata before routing.

## Schema-map routing

The `schemas/frontmatter/schema-map.json` file describes the legacy default
routing table used when no `$schema` field is present in Markdown frontmatter:

```json
{
  "default": "schemas/frontmatter/by-type/document/latest.json",
  "byType": {
    "document":  "schemas/frontmatter/by-type/document/latest.json",
    "work-item": "schemas/frontmatter/by-type/work-item/latest.json"
  }
}
```

The same table can be overridden per-project in legacy `.doc.json` or in the
canonical nested `dv.yaml` config:

```json
schemaMap:
  byType:
    adr: schemas/frontmatter/adr/current.json
```

The runtime resolution order is (highest priority first):

1. **Inline schema** — `$inlineSchema` or `schema` field is an object
2. **Embedded ref** — `$schema` or `schema` field is a URI string
3. **Property-based routing** — `schemaMap.bySubtype[subtype]` → `schemaMap.byType[type]`
4. **Default** — `schemaMap.default`

This logic lives in [`lib/schema/resolver.ts`](../lib/schema/resolver.ts).
New document type packs should also provide a manifest that matches
`schemas/doc-vader/document-type-pack.json`.

---

## Support schemas

### `metadata/base.json`

Provides the canonical routing fields (`namespace`, `type`, optional `subtype`)
that every routed document resolves before handler selection.

### `frontmatter/support/base/`

Provides compatibility fields (`id`, `title`, `type`, `status`) used by older
Markdown frontmatter schemas. Referenced by `$ref` from the document and
work-item compatibility schemas.

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

## Adding a new document type

1. Choose a stable `namespace` and `type`; add `subtype` only for natural
   variants.
2. Create a metadata schema that composes `schemas/metadata/base.json`.
3. Create a content schema if body structure is governed.
4. Add templates that emit `namespace`, `type`, optional `subtype`, `$schema`,
   and `$content_schema` when applicable.
5. Add a document-pack manifest matching
   `schemas/doc-vader/document-type-pack.json`.
6. Provide nested `dv.yaml` defaults for directories that intentionally infer
   namespace or type.
7. Add validation fixtures and focused tests.

---

## References

- [JSON Schema draft-2020-12](https://json-schema.org/draft/2020-12/release-notes)
- [Ajv 8 documentation](https://ajv.js.org/)
- [lib/schema/resolver.ts](../lib/schema/resolver.ts) — DRY schema routing logic
- [lib/config/schema.ts](../lib/config/schema.ts) — TypeBox config schema
