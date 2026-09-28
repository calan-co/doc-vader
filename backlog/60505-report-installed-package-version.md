---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60505
title: Report Installed Package Version
summary: Make the CLI report the installed package version instead of a stale constant.
type: work-item
subtype: bug
lifecycle: active
status: completed
status_reason: completed
priority: high
completed_date: '2026-09-28'
links:
  evidence:
    - '[[record-wi-60505-package-version-uat]]'
tags:
  - package
  - uat
---

## Tasks

- [x] Reproduce the mismatch between `dv --version` and package metadata.
- [x] Add a CLI version regression test.
- [x] Resolve package metadata from source and installed builds.
- [x] Verify a packed-package install reports its package version.

## Acceptance Criteria

- [x] `dv --version` equals the installed package version.
- [x] Focused test, typecheck, build, and packed-package smoke test pass.
