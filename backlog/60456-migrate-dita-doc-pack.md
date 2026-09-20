---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60456
title: Migrate DITA Doc-Pack
summary: Migrate the dita domain into a self-contained doc-pack.
type: work-item
subtype: story
lifecycle: active
status: ready
priority: high
estimated: 3
links:
  depends_on:
    - '[[60451-migrate-core-doc-pack.md]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-pack-registry-and-domain-pack-migration-prd.md]]'
  evidence:
    - '[[record-20260920-224355-60456]]'
tags:
  - afk
  - document-packs
  - refactor
---

## Goal

Migrate `dita` as an independently validated Phase 4 doc-pack.

## Background

This pack owns DITA-specific models and transforms. It follows accepted registry and pack-conformance
patterns without redesigning their interfaces.

## Tasks

- [ ] Confirm the Phase 1 inventory scope for `dita`.
- [ ] Move the domain metadata/body models, renderer templates, semantic
      contexts where applicable, tests, and fixtures into the pack.
- [ ] Replace domain consumer paths with logical references.
- [ ] Prove that no legacy aliases are introduced.

## Deliverables

- A `dita` pack with pack-local fixtures and tests.
- Updated consumers and Phase 4 acceptance evidence.

## Acceptance Criteria

- [ ] The pack has a coherent domain boundary and declared dependencies.
- [ ] Every moved artifact has a logical reference and pack-owned test coverage.
- [ ] Focused domain tests, repository validation, docs lint, and the phase gate
      pass.

## Relationships

- part_of: `[[60447-doc-pack-domain-migration-epic.md]]`
