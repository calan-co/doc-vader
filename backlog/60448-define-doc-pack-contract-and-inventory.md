---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60448
title: Define Doc-Pack Contract and Inventory
summary: Define the doc-pack contract, catalog-only registry interface, and complete migration inventory before moving any production asset.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 3
links:
  depends_on:
    - '[[60440-document-pack-routing-contract.md]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-pack-registry-and-domain-pack-migration-prd.md]]'
  evidence:
    - '[[record-20260920-224355-60448]]'
tags:
  - afk
  - document-packs
  - refactor
---

## Goal

Define the doc-pack contract, catalog-only registry interface, and complete migration inventory before moving any production asset.

## Background

This is a dependency-ordered slice of the approved doc-pack registry and domain
migration PRD. The registry remains catalog-only; sourcing, runtime execution,
activation, lifecycle, and business rules stay outside its interface.

## Tasks

- [ ] Add the syntax-agnostic `doc-pack` manifest contract and documentation.
- [ ] Document the catalog-only `DocPackRegistry` interface and prohibited responsibilities.
- [ ] Inventory every built-in artifact, its consumers and dependencies, its proposed domain owner, and its logical artifact ID.
- [ ] Map every hard-coded internal path to its logical replacement.
- [ ] Define embedded/referenced extension declarations, explicit activation consent, and pack-owned tests, fixtures, and Phase 1 verification output.

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
