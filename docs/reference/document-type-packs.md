---
$schema: /frontmatter/document
id: refdocpack-60440
title: Document Type Packs
type: document
subtype: reference
lifecycle: active
status: ready
tags:
  - extensibility
  - document-packs
  - schemas
links:
  reference:
    - '[[../architecture/decisions/adr-011-document-pack-routing-and-config.md]]'
---

# Document Type Packs

A document type pack is a package-owned bundle that teaches Doc-Vader how to
recognize, validate, template, and optionally operate on a document family.

A pack may contribute:

- metadata schemas
- content schemas
- templates
- routing defaults
- extension commands
- checks, review profiles, or handlers

## Canonical Metadata

Doc-Vader routes documents by metadata. Markdown YAML frontmatter is one format
adapter that can carry metadata; it is not the domain model.

Every canonical document route has:

```yaml
namespace: example.decisions
type: decision
subtype: adr # optional
```

Rules:

- `namespace` is required in canonical metadata and names the pack or product
  vocabulary owner.
- `type` is required and selects the document family within the namespace.
- `subtype` is optional. Use it only when the document family has natural
  variants.

The route key is:

```text
namespace:type[:subtype]
```

Lookup precedence is exact subtype route, type route, namespace fallback, then an
unsupported-document diagnostic.

## Namespace Inference

The target routing model allows existing and generated documents to omit
`namespace` when Doc-Vader can infer it before routing. Inference must not
silently mutate files.

The intended precedence is:

1. Explicit document metadata.
2. Explicit `$schema` resolved through the schema or pack registry.
3. Merged nearest `dv.yaml` defaults.
4. Unsupported-document diagnostic.

`dv.yaml` discovery and merge are not implemented yet. Current templates should
emit explicit routing metadata, and runtime compatibility loaders accept only
explicitly supplied `.doc.json` files.

Example:

```yaml
# backlog/dv.yaml
namespace: doc-vader.work-management
defaultType: work-item
```

```yaml
# backlog/records/dv.yaml
defaultType: record
```

When `dv.yaml` discovery is implemented, a record in `backlog/records/` will
inherit the namespace from `backlog/dv.yaml` and the type from the closer
`backlog/records/dv.yaml`.

## Doc-Pack Manifest and Registry

A `doc-pack` is the encompassing, syntax-agnostic domain bundle. It is distinct
from the `document-type-pack` contribution descriptor below: a doc-pack names a
stable domain and catalogs its document-type contributions and other assets.
Its manifest follows `schemas/doc-vader/doc-pack.json` and has these fields:

- `schemaVersion`: the `doc-vader/doc-pack/v1` contract identifier.
- `id` and `namespace`: stable pack identity and vocabulary ownership; `id` must not contain `:` because it prefixes logical references.
- `dependencies`: stable IDs of packs that must already be registered.
- `artifacts`: logical artifact IDs, kinds, and opaque `ref` values.
- `documentTypePacks`: logical contribution IDs and opaque `ref` values for
  `document-type-pack` descriptors.
- `extensions`: embedded declarations or referenced declarations; referenced
  declarations carry an opaque `ref` value.
- `tests` and `fixtures`: pack-owned opaque references used by conformance
  suites.

`DocPackRegistry` is catalog-only. Its public contract is registration,
validation/reporting, `get`, authoritative `list`, and logical catalog
`resolve`. It validates identity, dependencies, collisions, and declared
references without dereferencing them. It does not source, load, execute, host, activate,
or manage lifecycle for packs or extensions. A runtime host is separately
responsible for explicit consent before it activates executable behavior.

A logical catalog reference is `<pack-id>:<declaration-id>`; resolving an
artifact, document-type contribution, or referenced extension returns its
declared opaque `ref`, not a loaded artifact or extension. Artifact IDs,
document-type contribution IDs, and referenced extension IDs must not collide
within a pack. Invalid registrations report diagnostics and do not replace a
registered pack.

## Pack Manifest

A document-type contribution manifest follows
`schemas/doc-vader/document-type-pack.json`.

```yaml
schemaVersion: doc-vader/document-type-pack/v1
name: Example Decisions
namespace: example.decisions
documentTypes:
  - type: decision
    subtypes:
      - adr
    metadataSchema: schemas/example/metadata/decision.json
    contentSchema: schemas/example/content/decision.json
templates:
  - path: templates/example/decision.md.tpl
    type: decision
    subtype: adr
configDefaults:
  namespace: example.decisions
  defaultType: decision
```

The manifest names the pack-level namespace once. Each document type declares the
schema and optional handler used for that type.

## Schema Authoring

Create metadata schemas by composing the base routing contract:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "/example/metadata/decision",
  "allOf": [
    { "$ref": "/metadata/base" },
    {
      "type": "object",
      "properties": {
        "namespace": { "const": "example.decisions" },
        "type": { "const": "decision" },
        "subtype": { "enum": ["adr"] }
      }
    }
  ]
}
```

Keep format names out of schema titles and descriptions unless the schema truly
only applies to one format. Use `metadata` for the canonical domain concept;
use `frontmatter` only when documenting Markdown serialization compatibility.

## Templates

Templates should declare the route fields and schema paths they emit:

```yaml
---
namespace: example.decisions
type: decision
subtype: adr
$schema: schemas/example/metadata/decision.json
$content_schema: schemas/example/content/decision.json
---
```

Until `dv.yaml` discovery is implemented, templates must emit explicit routing
metadata. A future template that relies on `dv.yaml` inference must document
that requirement in its pack README and keep the emitted `type` explicit.

## Validation Checklist

For a document type pack:

- [ ] Choose a stable `namespace`.
- [ ] Define one or more `type` values.
- [ ] Use `subtype` only for natural variants.
- [ ] Compose metadata schemas from `schemas/metadata/base.json`.
- [ ] Provide content schemas when Markdown body structure matters.
- [ ] Provide templates for generated or recommended authoring.
- [ ] Do not rely on `dv.yaml` defaults until runtime discovery is implemented.
- [ ] Add extension commands only when behavior is needed.
- [ ] Validate examples with `pnpm run docs:lint` and the relevant package gate.
