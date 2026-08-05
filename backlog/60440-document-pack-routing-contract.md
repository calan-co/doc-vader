---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60440
title: Document Pack Routing Contract
summary: Define Doc-Vader metadata routing, nested dv.yaml config, and author guidance for extensions and document type packs.
type: work-item
subtype: task
lifecycle: active
status: running
status_reason: implementation
priority: high
estimated: 3
links:
  reference:
    - '[[../docs/architecture/decisions/adr-009-storage-and-format-seams.md]]'
    - '[[../docs/architecture/decisions/adr-010-composable-evaluation-primitives.md]]'
  evidence: []
tags:
  - afk
  - architecture
  - extensibility
  - document-packs
---

## Goal

Lock down the Doc-Vader document-pack routing contract: canonical metadata uses
`namespace`, `type`, and optional `subtype`; `frontmatter` is treated as a
Markdown serialization term; nested `dv.yaml` config provides local inference
defaults; extension and document-pack authors have README-style guidance.

## Background

Doc-Vader already has extension manifests, schema maps, base schemas, and a
registry surface. The missing contract is the durable author-facing vocabulary
and configuration model for adding new document kinds without leaking Markdown
frontmatter into the core domain model.

## Tasks

- [ ] Capture an ADR for metadata routing, namespace inference, and nested
      `dv.yaml` configuration.
- [ ] Add or update schema contracts for canonical metadata, document-pack
      manifests, and Doc-Vader config defaults.
- [ ] Document extension author responsibilities and document-pack author
      responsibilities.
- [ ] Update schema reference documentation to explain metadata versus
      frontmatter compatibility paths.
- [ ] Add focused tests for the config schema routing fields.
- [ ] Run docs and backlog validation gates.

## Deliverables

- ADR for document-pack routing and nested config.
- Reference docs for document type pack authors.
- Reference docs for extension authors.
- Schema/config contract updates and focused tests.

## Acceptance Criteria

- [ ] Canonical metadata requires `namespace` and `type`; `subtype` remains
      optional.
- [ ] Routing precedence is documented: explicit metadata, `$schema`, merged
      `dv.yaml`, then unsupported-document diagnostic.
- [ ] Nested `dv.yaml` merge semantics are documented with closer config
      overriding parent values.
- [ ] Existing frontmatter schema paths are documented as compatibility paths,
      not the canonical domain term.
- [ ] Extension and document-pack author docs include install/manifest examples.
- [ ] Focused config schema tests pass.
- [ ] `pnpm run docs:lint` passes.
- [ ] `pnpm run backlog:validate` passes.
