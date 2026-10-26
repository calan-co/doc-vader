---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60518
title: Preserve Runtime State During Recovery
summary: Prevent real forced Work recovery from restoring or deleting Doc-Vader runtime internals while a live SQLite runtime store is in use.
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
    - https://github.com/calan-co/doc-vader/pull/118
  reference:
    - '[[60517-expired-running-runtime-claim-recovery]]'
    - https://github.com/calan-co/doc-vader/pull/117
  evidence:
    - '[[record-wi-60518-validation]]'
tags:
  - afk
  - runtime
  - recovery
  - sqlite
---

## Goal

Exclude Doc-Vader runtime internals from forced recovery checkpoint/restore so
recovery keeps a usable runtime store for its terminal record and subsequent
claim.

## Tasks

- [x] Add a real forced-recovery regression with an untracked runtime database.
- [x] Exclude runtime internals from dirty-path and branch-derived recovery locks.
- [x] Validate and review the correction.

## Acceptance Criteria

- [x] Real forced reconcile recovery never checkpoints, restores, or locks `.doc-vader/runtime/**`.
- [x] Recovery finishes with a readable initialized runtime database after reclaim.
- [x] A subsequent Work claim succeeds.
