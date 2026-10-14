---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60509
title: Implement Linkity Remark Adapter
summary: Integrate Linkity into the remark lint pipeline with repository-relative diagnostics.
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
    - '[[record-20261014-044753-60509]]'
tags:
  - documentation
  - linkity
---

## Statement

Replace the bespoke `fs.existsSync` cross-reference path check with a Linkity-backed remark adapter.

## Tasks

- [x] Deliver the scoped Linkity PR #110 implementation and validation.

## Acceptance Criteria

- [x] Linkity is an explicit, pinned project dependency.
- [x] Lint output identifies the source file, target, and failure class.
- [x] The old validator is removed or delegates entirely to Linkity.
- [x] Existing lint configuration and CLI surfaces remain compatible.
