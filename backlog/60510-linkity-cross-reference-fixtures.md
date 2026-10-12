---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60510
title: Add Linkity Cross-Reference Fixtures
summary: Cover Linkity behavior with real Markdown fixtures and integration tests.
type: work-item
subtype: task
lifecycle: active
status: completed
priority: high
links:
  depends_on:
    - '[[60509-linkity-remark-adapter]]'
  reference:
    - '[[60507-linkity-cross-reference-validation-cutover]]'
tags:
  - documentation
  - linkity
  - testing
---

## Statement

Add focused fixtures for valid and invalid links so Linkity behavior is protected independently of the current documentation corpus.

## Tasks

- [x] Add fixtures for relative, fragment, encoded, external, template, and generated targets.
- [x] Exercise broken-target and missing-anchor diagnostics through docs-lint integration.

## Acceptance Criteria

- [x] Tests cover relative paths, fragments, encoded paths, external URLs, template targets, and generated-artifact policy.
- [x] Tests prove broken targets and missing anchors fail with actionable diagnostics.
- [x] Tests run through the same docs-lint integration used by CI.
