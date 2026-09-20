---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60440
title: Document Pack Routing Contract
summary: Define Doc-Vader metadata routing, nested dv.yaml config, and author guidance for extensions and document type packs.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 3
actual: 3
completed_date: '2026-08-05'
commits:
  9f52898: 'docs(extensibility): define document pack routing contract'
links:
  reference:
    - '[[../docs/architecture/decisions/adr-009-storage-and-format-seams.md]]'
    - '[[../docs/architecture/decisions/adr-010-composable-evaluation-primitives.md]]'
  evidence:
    - '[[record-wi-60440-validation]]'
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/91
tags:
  - afk
  - architecture
  - extensibility
  - document-packs
---

## Goal

Lock down the Doc-Vader document-pack routing contract: canonical metadata uses
`namespace`, `type`, and optional `subtype`; `frontmatter` is treated as a
Markdown serialization term; nested `dv.yaml` config defines future local
inference defaults; extension and document-pack authors have README-style guidance.

## Background

Doc-Vader already has extension manifests, schema maps, base schemas, and a
registry surface. The missing contract is the durable author-facing vocabulary
and configuration model for adding new document kinds without leaking Markdown
frontmatter into the core domain model.

## Tasks

- [x] Capture an ADR for metadata routing, namespace inference, and nested
      `dv.yaml` configuration.
- [x] Add or update schema contracts for canonical metadata, document-pack
      manifests, and Doc-Vader config defaults.
- [x] Document extension author responsibilities and document-pack author
      responsibilities.
- [x] Update schema reference documentation to explain metadata versus
      frontmatter compatibility paths.
- [x] Add focused tests for the config schema routing fields.
- [x] Run docs and backlog validation gates.

## Deliverables

- ADR for document-pack routing and nested config.
- Reference docs for document type pack authors.
- Reference docs for extension authors.
- Schema/config contract updates and focused tests.

## Acceptance Criteria

- [x] Canonical metadata requires `namespace` and `type`; `subtype` remains
      optional.
- [x] Routing precedence is documented: explicit metadata, `$schema`, merged
      `dv.yaml`, then unsupported-document diagnostic.
- [x] Nested `dv.yaml` merge semantics are documented with closer config
      overriding parent values.
- [x] Existing frontmatter schema paths are documented as compatibility paths,
      not the canonical domain term.
- [x] Extension and document-pack author docs include install/manifest examples.
- [x] Focused config schema tests pass.
- [x] `pnpm run docs:lint` passes.
- [x] `pnpm run backlog:validate` passes.

- 2026-08-05: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.
