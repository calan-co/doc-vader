---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60474
title: Fix Template Compliance Disabled Sentinel
summary: Ensure disabled template-compliance configuration does not require the __disabled__ heading across documentation.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
completed_date: '2026-08-24'
priority: high
estimated: 1
tags: [docs, lint, regression]
---

# Fix Template Compliance Disabled Sentinel

## Tasks

- [x] Reproduce and isolate disabled template-compliance configuration behavior.
- [x] Add a regression and repair the configuration/plugin interaction.
- [x] Validate docs lint without sentinel-heading failures.

## Acceptance Criteria

- [x] Disabled template compliance does not emit `__disabled__` heading findings.
- [x] Enabled template compliance retains required-heading coverage.
- [x] Focused tests and docs lint pass.
