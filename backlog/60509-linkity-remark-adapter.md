---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60509
title: Implement Linkity Remark Adapter
summary: Integrate Linkity into the remark lint pipeline with repository-relative diagnostics.
type: work-item
subtype: task
lifecycle: active
status: completed
priority: high
links:
  depends_on:
    - '[[60508-linkity-validation-contract]]'
  reference:
    - '[[60507-linkity-cross-reference-validation-cutover]]'
tags:
  - documentation
  - linkity
---

## Statement

Replace the bespoke `fs.existsSync` cross-reference path check with a Linkity-backed remark adapter.

## Tasks

- [x] Add the explicit Linkity runtime dependency and replace the cross-reference adapter.
- [x] Preserve compatible lint and CLI output while emitting actionable Linkity diagnostics.
- [x] Cover adapter behavior with focused regression tests.

## Acceptance Criteria

- [x] Linkity is an explicit, pinned project dependency.
- [x] Lint output identifies the source file, target, and failure class.
- [x] The old validator is removed or delegates entirely to Linkity.
- [x] Existing lint configuration and CLI surfaces remain compatible.
