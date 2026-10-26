---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60518
title: Preserve Runtime State During Recovery
summary: Prevent real forced Work recovery from restoring or deleting Doc-Vader runtime internals while a live SQLite runtime store is in use.
type: work-item
subtype: bug
lifecycle: active
status: running
status_reason: implementation
priority: critical
estimated: 1
links:
  reference:
    - '[[60517-expired-running-runtime-claim-recovery]]'
    - https://github.com/calan-co/doc-vader/pull/117
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

## Acceptance Criteria

- [ ] Real forced reconcile recovery never checkpoints, restores, or locks `.doc-vader/runtime/**`.
- [ ] Recovery finishes with a readable initialized runtime database after reclaim.
- [ ] A subsequent Work claim succeeds.
