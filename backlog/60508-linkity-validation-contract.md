---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60508
title: Define Linkity Validation Contract
summary: Establish the supported link, anchor, template, generated-artifact, and external-URL policy before implementation.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 4
actual: 4
completed_date: '2026-10-03'
links:
  reference:
    - '[[60507-linkity-cross-reference-validation-cutover]]'
  evidence:
    - '[[task-record-preflight]]'
    - '[[record-wi-60508-linkity-validation-contract-delivered-in-commit-d59c54dd]]'
tags:
  - afk
  - documentation
  - linkity
---

## Statement

Document the Linkity configuration and compatibility contract, including which paths are in scope and how ignored/generated targets are represented.

## Tasks

- [x] Deliver the scoped Linkity PR #110 implementation and validation.

## Acceptance Criteria

- [x] A policy records behavior for relative links, fragments, encoded paths, external URLs, templates, and generated artifacts.
- [x] The policy maps current `remark-lint-crossref` behavior to Linkity behavior and records intentional differences.
- [x] A migration plan identifies every lint-pipeline integration point.
