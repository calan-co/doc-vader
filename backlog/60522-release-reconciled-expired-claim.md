---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60522
title: Release Reconciled Expired Claims
summary: Retire the expired claim left by an exactly verified completed reconciliation without creating new claims or locks.
type: work-item
subtype: bug
lifecycle: active
status: completed
status_reason: completed
priority: critical
estimated: 1
actual: 1
completed_date: '2026-10-27'
links:
  evidence:
    - '[[record-wi-60522-node22-node24]]'
tags:
  - afk
  - runtime
  - claims
  - reconciliation
---

## Goal

Release an expired runtime claim only when its completed work item and immutable
reconciliation manifest prove the claim is the exact historical reconciliation
claim.

## Tasks

- [x] Add public CLI success and rejection coverage.
- [x] Retire only the manifest-bound expired claim and its remaining locks.
- [x] Record immutable runtime audit evidence.

## Acceptance Criteria

- [x] `dv work release-reconciled <work-item> --claim <expired-token> --json` succeeds only for the exact completed work item, expired manifest-bound claim, and verified manifest.
- [x] Active, missing, foreign, incomplete, and mismatched cases fail without creating ordinary claims or retroactive locks.
- [x] Success atomically removes all remaining claim locks and claim state while appending immutable audit evidence.
- [x] Public CLI coverage and required validation pass on Node 22 and Node 24.
