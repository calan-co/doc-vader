---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60514
title: Resolve Historical Merge Review Feedback
summary: Repair Work command inventory parity and fail-closed historical merge review findings.
type: work-item
subtype: task
lifecycle: active
status: running
status_reason: implementation
priority: high
estimated: 1
tags:
  - afk
  - runtime
  - regression
---

## Goal

Resolve review findings for the published historical merge reconciliation CLI without weakening its fail-closed checks.

## Tasks

- [x] Add the missing command inventory entry.
- [ ] Resolve verified historical merge review findings.
- [ ] Run focused and CI-relevant validation.

## Acceptance Criteria

- [x] `dv work --help` and the immutable inventory list the same commands.
- [ ] Policy loading works from both the source tree and packaged layout.
- [ ] Evidence references, commit links, and changed paths remain fail-closed.
- [ ] The Node 22 and Node 24 test suites pass.
