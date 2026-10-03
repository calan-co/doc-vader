---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60508
title: Define Linkity Validation Contract
summary: Establish the supported link, anchor, template, generated-artifact, and external-URL policy before implementation.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 4
links:
  reference:
    - '[[60507-linkity-cross-reference-validation-cutover]]'
tags:
  - afk
  - documentation
  - linkity
---

## Statement

Document the Linkity configuration and compatibility contract, including which paths are in scope and how ignored/generated targets are represented.

## Acceptance Criteria

- [x] A policy records behavior for relative links, fragments, encoded paths, external URLs, templates, and generated artifacts.
- [x] The policy maps current `remark-lint-crossref` behavior to Linkity behavior and records intentional differences.
- [x] A migration plan identifies every lint-pipeline integration point.
