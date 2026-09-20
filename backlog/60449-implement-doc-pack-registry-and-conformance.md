---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60449
title: Implement Doc-Pack Registry and Conformance
summary: Implement the catalog-only DocPackRegistry and pack conformance validation.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 3
links:
  depends_on:
    - '[[60448-define-doc-pack-contract-and-inventory.md]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-pack-registry-and-domain-pack-migration-prd.md]]'
  evidence: []
tags:
  - afk
  - document-packs
  - refactor
---

## Goal

Implement the catalog-only DocPackRegistry and pack conformance validation.

## Background

This is a dependency-ordered slice of the approved doc-pack registry and domain
migration PRD. The registry remains catalog-only; sourcing, runtime execution,
activation, lifecycle, and business rules stay outside its interface.

## Tasks

- [ ] Implement register, get, list, resolve, and validation/reporting seams.
- [ ] Validate pack identity, dependency declarations, collision rules, and consumable/executable references.
- [ ] Validate embedded and referenced extension declarations without executing them.
- [ ] Add root registry/cross-pack tests and pack conformance fixtures.

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
