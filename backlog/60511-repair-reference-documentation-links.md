---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60511
title: Repair Reference Documentation Links
summary: Correct or remove the current broken-link baseline in reference docs and templates.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 6
actual: 6
completed_date: '2026-10-14'
links:
  depends_on:
    - '[[60508-linkity-validation-contract]]'
  reference:
    - '[[60507-linkity-cross-reference-validation-cutover]]'
  evidence:
    - '[[../docs/reference/linkity-validation-contract.md]]'
tags:
  - documentation
  - linkity
---

## Statement

Repair the current broken cross-references using the approved Linkity policy; do not preserve nonexistent targets merely to silence lint.

## Tasks

- [x] Deliver the scoped Linkity PR #110 implementation and validation.

## Acceptance Criteria

- [x] Every current cross-reference warning is classified as repaired, intentionally ignored, or removed.
- [x] FAQ, work-management examples, and template links resolve to real targets or documented substitutes.
- [x] Documentation lint reports no broken-reference warnings in the migrated scope.
