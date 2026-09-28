---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60503
title: Retire dv4sandcastle from MVP Scope
summary: Remove the retired Sandcastle adapter surface and exclude future Sandcastle workflow work from the MVP.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
completed_date: '2026-09-28'
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/105
  evidence:
    - '[[record-wi-60503-mvp-scope-retirement]]'
  reference:
    - '[[60421-greenfield-sandcastle-e2e-workflow-contract]]'
    - '[[60422-greenfield-sandcastle-init-to-implementation-harness]]'
    - '[[60423-preserve-greenfield-sandcastle-e2e-readiness]]'
tags:
  - mvp
  - scope
  - sandcastle
---

## Goal

Remove the retired `dv4sandcastle` adapter and exclude Sandcastle workflow
integration from the Doc-Vader MVP.

## Tasks

- [x] Remove the adapter, generated artifacts, adapter-only tests, and dev dependency.
- [x] Remove current MVP guidance while retaining completed historical records.
- [x] Archive active Sandcastle MVP proposals as cancelled.
- [x] Validate the remaining `dv work` surface and repository gates.
- [x] Route work-item validation through work-management schemas and remove legacy work-item schemas.

## Acceptance Criteria

- [x] No `dv4sandcastle` adapter or generated `.sandcastle` artifacts remain.
- [x] The project brief scopes MVP work to `dv work` and `dv wi`.
- [x] Active Sandcastle MVP proposals are archived as cancelled.
- [x] Historical records remain readable without links to removed artifacts.
- [x] Focused and repository validation pass.
- [x] `aborted` work items with `cancelled` reasons validate through the authoritative schema.

## Evidence

- 2026-09-28: Maintainer directed removal of `dv4sandcastle` and its MVP scope.
