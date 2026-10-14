---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60507
title: Linkity Cross-Reference Validation Cutover
summary: Replace the repository's bespoke Markdown cross-reference validator with Linkity and repair the documented reference surface.
type: work-item
subtype: epic
lifecycle: active
status: ready
priority: high
estimated: 24
links:
  reference:
    - '[[60508-linkity-validation-contract]]'
    - '[[60509-linkity-remark-adapter]]'
    - '[[60510-linkity-cross-reference-fixtures]]'
    - '[[60511-repair-reference-documentation-links]]'
    - '[[60512-enforce-linkity-documentation-gate]]'
tags:
  - documentation
  - linkity
  - quality
---

## Description

Adopt Linkity as the authoritative cross-reference engine, preserve useful
remark diagnostics, and eliminate the current broken-link warning baseline.

## Acceptance Criteria

- [ ] Linkity validates local Markdown references and anchors in the docs lint pipeline.
- [ ] The bespoke filesystem-only validator is removed or reduced to a Linkity adapter.
- [ ] Reference documentation and templates have no Linkity-reported broken links.
- [ ] CI treats Linkity failures as errors with actionable file and link diagnostics.

## Checklist

- [ ] All child work items are complete and linked.
- [ ] The final documentation gate is green on every CI platform.
