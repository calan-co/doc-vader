---
$schema: /frontmatter/document
id: adrdocpackrouting-9011
title: Route document packs by metadata and nested dv.yaml config
type: document
subtype: generic
status: ready
lifecycle: active
tags:
  - adr
  - architecture
  - extensibility
  - document-packs
links:
  reference:
    - '[[adr-009-storage-and-format-seams.md]]'
    - '[[adr-010-composable-evaluation-primitives.md]]'
    - '[[../../../CONTEXT.md]]'
---

## Context and Problem Statement

Doc-Vader is expanding from built-in Work Management documents to package-authored
document families. The existing system already has extension manifests, schema
maps, work-management schemas, templates, and package loading, but the routing
vocabulary still leaks the Markdown term `frontmatter` into concepts that should
apply to any supported storage or format adapter.

Doc-Vader needs a small, stable routing contract for extension and document-pack
authors. Existing backlog documents should continue to route without immediate
bulk edits, but new packages should not depend on path-specific Work Management
internals or invent incompatible type fields.

## Decision

Doc-Vader routes governed documents by canonical metadata, not by Markdown
frontmatter. Canonical routing metadata requires:

- `namespace`: required package or product namespace that owns the routing
  vocabulary.
- `type`: required document type within that namespace.
- `subtype`: optional specialization used only when a document family has
  meaningful variants.

The canonical routing key is:

```text
namespace:type[:subtype]
```

Lookup precedence is:

1. Exact route: `namespace:type:subtype` when `subtype` is present.
2. Type route: `namespace:type`.
3. Namespace fallback: `namespace:*`.
4. Unsupported-document diagnostic.

Metadata inference is allowed before routing, with deterministic provenance:

1. Explicit document metadata wins.
2. Explicit `$schema` resolves through the schema or document-pack registry.
3. Merged `dv.yaml` config supplies local defaults.
4. If none of those apply, Doc-Vader emits an unsupported-document diagnostic.

`frontmatter` remains a compatibility and adapter term only. A Markdown format
adapter may parse YAML frontmatter into canonical metadata, and existing schema
paths that contain `frontmatter` remain valid compatibility references while the
project is in alpha. New architecture, extension APIs, and document-pack docs use
`metadata` for the domain concept.

Doc-Vader configuration is declared in `dv.yaml`. Config files may appear at the
repository root and in nested document directories. Effective configuration for a
document is computed by merging `dv.yaml` files from the repository root to the
document directory, with closer values overriding parent values.

Minimal document-root config examples:

```yaml
# backlog/dv.yaml
namespace: doc-vader.work-management
defaultType: work-item
```

```yaml
# backlog/records/dv.yaml
defaultType: record
```

For `backlog/records/record-wi-60440-validation.md`, the merged config infers
`namespace: doc-vader.work-management` from `backlog/dv.yaml` and
`type: record` from `backlog/records/dv.yaml` unless the document or `$schema`
declares a more specific route.

Legacy `.doc-vader/backlog-consumer.json` and `.doc.json` remain compatibility
inputs during alpha migration, but `dv.yaml` is the canonical configuration name
for new authoring and nested document roots.

## Decision Drivers

- Extension packages need collision-resistant routing keys.
- Existing backlog documents need deterministic namespace inference without a
  bulk metadata migration.
- Config should be local to the documents it governs instead of using brittle
  path maps from a remote root file.
- Frontmatter is a Markdown serialization detail and must not constrain future
  JSON, database, generated, or hosted document adapters.
- Author documentation should explain one vocabulary across schemas, templates,
  commands, and validation behavior.

## Consequences

Positive:

- Document-pack authors can register schemas, templates, handlers, and checks by
  namespace-qualified route.
- Existing backlog files can route through `$schema` and nested config inference.
- Nested `dv.yaml` removes the need to list every governed path in one central
  config file.
- Metadata terminology aligns with storage and format adapter seams.

Negative/Risks:

- Built-in code still contains `frontmatter` names that must be migrated over
  time.
- Nested config discovery must report provenance so inferred routes are
  debuggable.
- Config merge behavior must stay simple; complex array merge policies are
  deferred until a concrete package needs them.

## Validation

- `schemas/metadata/base.json` defines the canonical routing metadata contract.
- `schemas/doc-vader/config.json` defines `dv.yaml` routing defaults.
- `schemas/doc-vader/document-type-pack.json` defines the document-pack manifest
  shape.
- Extension and document-pack author docs describe namespace, type, subtype,
  schema, template, extension, and config responsibilities.
- Focused config schema tests cover routing defaults and schema examples.
