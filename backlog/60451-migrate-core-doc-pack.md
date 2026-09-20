---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60451
title: Migrate Core Doc-Pack
summary: Migrate shared metadata, routing, semantic contexts, and renderer primitives into the core pack.
type: work-item
subtype: story
lifecycle: active
status: ready
priority: high
estimated: 3
links:
  depends_on:
    - '[[60449-implement-doc-pack-registry-and-conformance.md]]'
    - '[[60450-migrate-sdlc-core-doc-pack-pilot.md]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-pack-registry-and-domain-pack-migration-prd.md]]'
  evidence: []
tags:
  - afk
  - document-packs
  - refactor
---

## Goal

Migrate shared metadata, routing, semantic contexts, and renderer primitives into the core pack.

## Background

This is a dependency-ordered slice of the approved doc-pack registry and domain
migration PRD. The registry remains catalog-only; sourcing, runtime execution,
activation, lifecycle, and business rules stay outside its interface.

## Tasks

- [ ] Confirm the Phase 1 inventory scope for `core`.
- [ ] Move shared metadata/body models, renderer primitives, semantic contexts, tests, and fixtures into the pack.
- [ ] Replace core consumer paths with logical references.
- [ ] Prove that no legacy aliases are introduced.

## Deliverables

- A bounded implementation change with focused tests and fixtures.
- A structured acceptance report with fresh validation evidence.

## Acceptance Criteria

- [ ] The changed scope matches this work item and the approved PRD.
- [ ] No registry responsibility expands beyond registration, validation,
      authoritative listing, and opaque reference resolution.
- [ ] Focused tests, repository validation, docs lint, and the applicable phase
      gate pass.

## Relationships

- part_of: `[[60447-doc-pack-domain-migration-epic.md]]`
