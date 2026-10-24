---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60512
title: Enforce Linkity Documentation Gate
summary: Make Linkity validation the required documentation cross-reference gate in local and hosted CI.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 3
actual: 3
completed_date: '2026-10-14'
links:
  depends_on:
    - '[[60510-linkity-cross-reference-fixtures]]'
    - '[[60511-repair-reference-documentation-links]]'
  reference:
    - '[[60507-linkity-cross-reference-validation-cutover]]'
  evidence:
    - '[[../docs/reference/linkity-validation-contract.md]]'
    - '[[record-20261014-044754-60512]]'
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/110
tags:
  - documentation
  - linkity
  - ci
---

## Statement

Promote the validated Linkity integration from warning-only observation to an enforced documentation quality gate.

## Tasks

- [x] Deliver the scoped Linkity PR #110 implementation and validation.

## Acceptance Criteria

- [x] Local docs lint fails on Linkity-reported in-scope broken links.
- [x] Hosted CI runs the same Linkity gate.
- [x] Migration documentation explains the enforced policy and escape-hatch process.
