---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60516
title: Recover Expired Runtime Scope Locks
summary: Reclaim scope locks owned by expired halted claims during forced Work recovery without weakening active-claim safety.
type: work-item
subtype: bug
lifecycle: active
status: completed
status_reason: completed
priority: critical
estimated: 1
actual: 1
completed_date: '2026-10-26'
commits:
  6bdcd9ff30b4f424b4c2c4c7c94d185729465c7e: 'fix(work): reclaim expired scope locks during recovery'
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/116
  reference:
    - '[[60369-task-recover-command]]'
    - '[[60367-claim-prune-and-rm]]'
    - '[[60385-flat-claim-scopes-and-lock-policies]]'
  evidence:
    - '[[record-20261026-173900-60516]]'
tags:
  - afk
  - runtime
  - recovery
  - claims
  - locks
---

## Goal

Restore claimability after an expired, halted runtime claim leaves an active
scope lock, while preserving execution-log audit evidence and never reclaiming
an active claim.

## Tasks

- [x] Reproduce forced recovery blocked by an expired claim-owned execute lock.
- [x] Add a public `dv work recover --force reconcile --json` regression.
- [x] Reclaim only expired, non-running claim ownership and record the scope-lock audit.
- [x] Verify recovery and a subsequent `dv work claim` succeed.

## Acceptance Criteria

- [x] Forced recovery reclaims only scope locks owned by an expired, non-running claim.
- [x] Active claims and expired claims with a running execution log remain fail-closed.
- [x] Recovery appends an `expired` execution-log entry with reclaimed scope-lock evidence.
- [x] The public Work CLI regression and relevant repository validation pass.
