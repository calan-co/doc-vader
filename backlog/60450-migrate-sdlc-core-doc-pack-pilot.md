---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60450
title: Migrate SDLC-Core Doc-Pack Pilot
summary: Migrate the agreed SDLC artifacts into sdlc-core without legacy aliases.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 3
links:
  depends_on:
    - '[[60449-implement-doc-pack-registry-and-conformance.md]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-pack-registry-and-domain-pack-migration-prd.md]]'
  evidence:
    - '[[record-20260920-224355-60450]]'
tags:
  - afk
  - document-packs
  - refactor
---

## Goal

Migrate the agreed SDLC artifacts into sdlc-core without legacy aliases.

## Background

This is a dependency-ordered slice of the approved doc-pack registry and domain
migration PRD. The registry remains catalog-only; sourcing, runtime execution,
activation, lifecycle, and business rules stay outside its interface.

## Tasks

- [ ] Move agreed SDLC artifacts, models, templates, policies, and semantic contexts into `sdlc-core`.
- [ ] Move all pack-specific tests and fixtures into the pack.
- [ ] Replace affected internal paths with registered logical references.
- [ ] Delete obsolete path assumptions; do not add aliases.

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
