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
internals or invent incompatible type fields. It also needs a clear distinction
between a document-type contribution and the broader domain bundle that contains
it, without turning routing into a package-management subsystem.

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

The target metadata-inference order is deterministic:

1. Explicit document metadata wins.
2. Explicit `$schema` resolves through the schema or document-pack registry.
3. Merged `dv.yaml` config supplies local defaults.
4. If none of those apply, Doc-Vader emits an unsupported-document diagnostic.

This release establishes the schema and authoring contract only. The current
runtime does not yet discover or merge `dv.yaml`; compatibility loaders continue
to accept explicitly supplied `.doc.json` files.

`frontmatter` remains a compatibility and adapter term only. A Markdown format
adapter may parse YAML frontmatter into canonical metadata, and existing schema
paths that contain `frontmatter` remain valid compatibility references while the
project is in alpha. New architecture, extension APIs, and document-pack docs use
`metadata` for the domain concept.

The target Doc-Vader configuration name is `dv.yaml`. It may appear at the
repository root and in nested document directories; when runtime discovery is
implemented, effective configuration will merge files from the repository root to
the document directory, with closer values overriding parent values. Within one
effective configuration, `document.namespace`, `document.defaultType`, and
`document.defaultSubtype` override their root-level legacy counterparts when
both are present. `document.schemaMap` likewise overrides the root `schemaMap`
as one value; its entries are not merged. Root-level routing fields remain for
legacy `.doc.json` compatibility.

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

When runtime discovery is implemented, `backlog/records/record-wi-60440-validation.md`
will inherit `namespace: doc-vader.work-management` from `backlog/dv.yaml` and
`type: record` from `backlog/records/dv.yaml` unless the document or `$schema`
declares a more specific route.

Legacy `.doc-vader/backlog-consumer.json` and `.doc.json` remain the supported
runtime inputs during alpha migration. `dv.yaml` is the intended canonical name
for the subsequent configuration-discovery implementation.

A `document-type-pack` is a focused contribution descriptor: it declares
routable document types and their metadata/body models, renderer templates,
routing defaults, and optional handlers. A `doc-pack` is a domain-level bundle
that identifies the pack, declares dependencies, collects artifacts and
document-type contributions, declares embedded or referenced extensions, and
owns its tests and fixtures.

`DocPackRegistry` is a catalog-only module. It owns registration/master identity,
registration and manifest validation, the authoritative registered-pack list,
and resolution of consumable or executable references from registered packs. It
does not source packs, load, execute, sandbox, or host them; apply business
rules; or manage installation, activation, update, removal, or lifecycle. It
returns opaque references to the appropriate source adapter, runtime host, or
consumer.

The registry validates extension declarations but never executes them. Executable
extensions require explicit activation outside the registry. Doc-Vader provides
a static third-party disclaimer rather than a registry trust system: packs and
extensions not authored by Doc-Vader are not reviewed, endorsed, sandboxed, or
guaranteed; users enable only sources they trust. Digests, attestations,
trust-level caching, expiry, and revocation are deferred.

Pack artifacts use syntax-agnostic terms: metadata model, body/content model,
renderer template, and semantic context. JSON-LD contexts are optional
`semantic-context` artifacts; packs must define stable metadata semantics but
may reuse, extend, or omit JSON-LD contexts. New internal consumers resolve
logical artifact references rather than repository-root paths; no internal
legacy aliases are introduced for the pack migration.

## Decision Drivers

- Extension packages need collision-resistant routing keys.
- Existing backlog documents need deterministic namespace inference without a
  bulk metadata migration.
- Config should be local to the documents it governs instead of using brittle
  path maps from a remote root file.
- Frontmatter is a Markdown serialization detail and must not constrain future
  JSON, database, generated, or hosted document adapters.
- A small catalog seam must not absorb source acquisition, runtime execution,
  lifecycle, or domain-policy responsibilities.
- Domain-level packs should be independently reusable without requiring every
  organization to adopt unrelated document frameworks.
- Author documentation should explain one vocabulary across schemas, templates,
  commands, and validation behavior.

## Consequences

Positive:

- Document-pack authors can register schemas, templates, handlers, and checks by
  namespace-qualified route.
- The schema contract prepares existing backlog files for a later `$schema` and
  nested-config inference implementation.
- Once discovery is implemented, nested `dv.yaml` will remove the need to list
  every governed path in one central config file.
- Metadata terminology aligns with storage and format adapter seams.
- Domain packs can reuse shared artifacts through declared dependencies while
  retaining pack-local tests and fixtures.

Negative/Risks:

- Built-in code still contains `frontmatter` names that must be migrated over
  time.
- Nested config discovery is not implemented yet; its implementation must report
  provenance so inferred routes are debuggable.
- Config merge behavior must stay simple; complex array merge policies are
  deferred until a concrete package needs them.
- A static third-party disclaimer is not a security control; later runtime-host
  work may add provenance or sandboxing without widening the registry.

## Validation

- `schemas/metadata/base.json` defines the canonical routing metadata contract.
- `schemas/doc-vader/config.json` defines the intended `dv.yaml` routing-default
  shape; it does not activate file discovery.
- `schemas/doc-vader/document-type-pack.json` defines the document-type
  contribution manifest shape.
- The doc-pack domain-bundle contract and AFK migration sequence are recorded in
  [`doc-pack-registry-and-domain-pack-migration-prd.md`](../../how-to/implementation-plans/doc-pack-registry-and-domain-pack-migration-prd.md).
- Extension and document-pack author docs describe namespace, type, subtype,
  schema, template, extension, and config responsibilities.
- Focused config schema tests cover routing defaults and schema examples.
