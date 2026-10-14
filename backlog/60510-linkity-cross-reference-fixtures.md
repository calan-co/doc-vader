---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60510
title: Add Linkity Cross-Reference Fixtures
summary: Cover Linkity behavior with real Markdown fixtures and integration tests.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 5
actual: 5
completed_date: '2026-10-14'
links:
  depends_on:
    - '[[60509-linkity-remark-adapter]]'
  reference:
    - '[[60507-linkity-cross-reference-validation-cutover]]'
  evidence:
    - '[[../docs/reference/linkity-validation-contract.md]]'
tags:
  - documentation
  - linkity
  - testing
---

## Statement

Add focused fixtures for valid and invalid links so Linkity behavior is protected independently of the current documentation corpus.

## Tasks

- [x] Deliver the scoped Linkity PR #110 implementation and validation.

## Acceptance Criteria

- [x] Tests cover relative paths, fragments, encoded paths, external URLs, template targets, and generated-artifact policy.
- [x] Tests prove broken targets and missing anchors fail with actionable diagnostics.
- [x] Tests run through the same docs-lint integration used by CI.
