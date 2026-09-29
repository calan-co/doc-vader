---
$schema: schemas/work-management/frontmatter/record.json
id: record:wi-60505-package-version-uat
title: Installed package version UAT evidence
summary: Evidence that the CLI reports the installed Doc-Vader package version.
type: record
subtype: test-result
lifecycle: active
status: ready
status_reason: recorded
links:
  supporting_reference:
    - '[[60505-report-installed-package-version]]'
---

## Recorded At

2026-09-28T23:10:00Z

## Outcome

pass

## Observation

A packed package installed into a clean temporary directory reported the same
version through `dv --version` as its package manifest.
