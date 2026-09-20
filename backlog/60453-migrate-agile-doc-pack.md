---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60453
title: Migrate AGILE Doc-Pack
summary: Migrate the agile domain into a self-contained doc-pack.
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
  evidence: []
tags:
  - afk
  - document-packs
  - refactor
---

## Goal

Migrate `agile` as an independently validated Phase 4 doc-pack.

## Background

This pack owns retrospectives, stand-ups, team agreements, and sprint artifacts. It follows accepted registry and pack-conformance
patterns without redesigning their interfaces.

## Tasks

- [ ] Confirm the Phase 1 inventory scope for `agile`.
- [ ] Move the domain metadata/body models, renderer templates, semantic
      contexts where applicable, tests, and fixtures into the pack.
- [ ] Replace domain consumer paths with logical references.
- [ ] Prove that no legacy aliases are introduced.

## Deliverables

- A `agile` pack with pack-local fixtures and tests.
- Updated consumers and Phase 4 acceptance evidence.

## Acceptance Criteria

- [ ] The pack has a coherent domain boundary and declared dependencies.
- [ ] Every moved artifact has a logical reference and pack-owned test coverage.
- [ ] Focused domain tests, repository validation, docs lint, and the phase gate
      pass.

## Relationships

- part_of: `[[60447-doc-pack-domain-migration-epic.md]]`
