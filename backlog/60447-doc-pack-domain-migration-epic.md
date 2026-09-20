---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60447
title: Doc-Pack Domain Migration Epic
summary: Coordinate the phased, AFK migration from repository-root assets to domain-level doc-packs.
type: work-item
subtype: epic
lifecycle: active
status: ready
priority: high
estimated: 3
links:
  reference:
    - '[[../docs/how-to/implementation-plans/doc-pack-registry-and-domain-pack-migration-prd.md]]'
  evidence:
    - '[[record-20260920-224355-60447]]'
tags:
  - afk
  - document-packs
  - refactor
---

## Goal

Coordinate the phased, AFK migration from repository-root assets to domain-level doc-packs.

## Background

This is a dependency-ordered slice of the approved doc-pack registry and domain
migration PRD. The registry remains catalog-only; sourcing, runtime execution,
activation, lifecycle, and business rules stay outside its interface.

## Tasks

- [ ] Complete the contract and inventory slice.
- [ ] Complete the registry and conformance slice.
- [ ] Complete the `sdlc-core` pilot.
- [ ] Complete each approved Phase 4 domain slice.

## Deliverables

- A bounded implementation change with focused tests and fixtures.
- A structured acceptance report with fresh validation evidence.

## Acceptance Criteria

- [ ] The changed scope matches this work item and the approved PRD.
- [ ] No registry responsibility expands beyond registration, validation,
      authoritative listing, and opaque reference resolution.
- [ ] Focused tests, repository validation, docs lint, and the applicable phase
      gate pass.
