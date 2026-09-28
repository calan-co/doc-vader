---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60504
title: Resolve Packaged Task Templates
summary: Ensure installed Doc-Vader packages render task prompts without consumer-owned template files.
type: work-item
subtype: bug
lifecycle: active
status: completed
status_reason: completed
priority: high
completed_date: '2026-09-28'
commits:
  292844743eed76124c672e2f57e89e8780ae8aa9: 'fix(task): resolve packaged prompt templates'
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/106
  evidence:
    - '[[record-wi-60504-packaged-template-uat]]'
tags:
  - package
  - uat
---

## Tasks

- [x] Reproduce `dv work prompt` failure from an installed prerelease package.
- [x] Add a regression test for consumers without template files.
- [x] Fall back to package-owned templates while preserving explicit consumer overrides.
- [x] Verify a packed-package smoke test.

## Acceptance Criteria

- [x] `dv work prompt` renders from an installed package in a clean consumer directory.
- [x] A consumer-provided template still takes precedence.
- [x] Focused package and repository validation pass.
