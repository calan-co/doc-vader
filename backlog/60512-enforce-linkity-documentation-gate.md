---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60512
title: Enforce Linkity Documentation Gate
summary: Make Linkity validation the required documentation cross-reference gate in local and hosted CI.
type: work-item
subtype: task
lifecycle: active
status: completed
priority: high
links:
  depends_on:
    - '[[60510-linkity-cross-reference-fixtures]]'
    - '[[60511-repair-reference-documentation-links]]'
  reference:
    - '[[60507-linkity-cross-reference-validation-cutover]]'
tags:
  - documentation
  - linkity
  - ci
---

## Statement

Promote the validated Linkity integration from warning-only observation to an enforced documentation quality gate.

## Tasks

- [x] Make local docs lint fail on in-scope Linkity failures.
- [x] Run the equivalent Linkity documentation gate in hosted CI.
- [x] Document the enforcement policy and escape-hatch process.

## Acceptance Criteria

- [x] Local docs lint fails on Linkity-reported in-scope broken links.
- [x] Hosted CI runs the same Linkity gate.
- [x] Migration documentation explains the enforced policy and escape-hatch process.
