---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60507
title: Linkity Cross-Reference Validation Cutover
summary: Replace the repository's bespoke Markdown cross-reference validator with Linkity and repair the documented reference surface.
type: work-item
subtype: epic
lifecycle: active
status: completed
status_reason: completed
priority: high
completed_date: '2026-10-11'
links:
  evidence:
    - https://github.com/calan-co/doc-vader/commit/73b5c57
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

## Tasks

- [x] Audit the existing cross-reference validator and define the Linkity cutover boundary.
- [x] Integrate the Linkity adapter, fixtures, reference repairs, and documentation gate.
- [x] Validate the cutover against the repository documentation scope and CI-equivalent checks.

## Description

Adopt Linkity as the authoritative cross-reference engine, preserve useful
remark diagnostics, and eliminate the current broken-link warning baseline.

## Acceptance Criteria

- [x] Linkity validates local Markdown references and anchors in the docs lint pipeline.
- [x] The bespoke filesystem-only validator is removed or reduced to a Linkity adapter.
- [x] Reference documentation and templates have no Linkity-reported broken links.
- [x] CI treats Linkity failures as errors with actionable file and link diagnostics.

## Checklist

- [x] All child work items are complete and linked.
- [x] The final documentation gate is green on every CI platform.
