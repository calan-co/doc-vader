---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60512
title: Enforce Linkity Documentation Gate
summary: Make Linkity validation the required documentation cross-reference gate in local and hosted CI.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 3
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

## Acceptance Criteria

- [ ] Local docs lint fails on Linkity-reported in-scope broken links.
- [ ] Hosted CI runs the same Linkity gate.
- [ ] Migration documentation explains the enforced policy and escape-hatch process.
