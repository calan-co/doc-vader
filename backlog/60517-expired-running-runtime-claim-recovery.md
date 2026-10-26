---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60517
title: Recover Expired Running Runtime Claims
summary: Recover a verifiably expired runtime claim whose latest execution record is still running without reclaiming active claims or unowned locks.
type: work-item
subtype: bug
lifecycle: active
status: running
status_reason: implementation
priority: critical
estimated: 1
links:
  reference:
    - '[[60516-expired-runtime-scope-lock-recovery]]'
    - https://github.com/calan-co/doc-vader/pull/116
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

## Acceptance Criteria

- [ ] Expired + `running` claims append a terminal `halted` / `expired` recovery record, reclaim only their own scope and file locks, and are deleted atomically.
- [ ] Active + `running` claims remain unchanged and fail closed.
- [ ] Recovery never fabricates scope or file locks.
- [ ] Focused runtime-store and public Work recovery regressions pass.
