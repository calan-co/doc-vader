---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60517
title: Recover Expired Running Runtime Claims
summary: Recover a verifiably expired runtime claim whose latest execution record is still running without reclaiming active claims or unowned locks.
type: work-item
subtype: bug
lifecycle: active
status: completed
status_reason: completed
priority: critical
estimated: 1
actual: 1
completed_date: '2026-10-26'
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/117
  reference:
    - '[[60516-expired-runtime-scope-lock-recovery]]'
    - https://github.com/calan-co/doc-vader/pull/116
  evidence:
    - '[[record-wi-60517-validation]]'
tags:
  - afk
  - runtime
  - recovery
  - claims
  - locks
---

## Goal

Allow forced Work recovery to reclaim only a claim that is expired at recovery
execution time, even when its latest execution-log record remains `running`.

## Tasks

- [x] Add expired + `running` and active + `running` regressions.
- [x] Reclaim only claims confirmed expired inside the recovery transaction.
- [x] Validate and review the correction.

## Acceptance Criteria

- [x] Expired + `running` claims append a terminal `halted` / `expired` recovery record, reclaim only their own scope and file locks, and are deleted atomically.
- [x] Active + `running` claims remain unchanged and fail closed.
- [x] Recovery never fabricates scope or file locks.
- [x] Focused runtime-store and public Work recovery regressions pass.
