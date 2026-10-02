---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60509
title: Implement Linkity Remark Adapter
summary: Integrate Linkity into the remark lint pipeline with repository-relative diagnostics.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 6
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

## Acceptance Criteria

- [ ] Linkity is an explicit, pinned project dependency.
- [ ] Lint output identifies the source file, target, and failure class.
- [ ] The old validator is removed or delegates entirely to Linkity.
- [ ] Existing lint configuration and CLI surfaces remain compatible.
