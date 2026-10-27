---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60519
title: Record Verified Historical Merge Evidence
summary: Permit CI and review evidence for a verified historical merge without claiming its already-published files.
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
    - https://github.com/calan-co/doc-vader/pull/119
  evidence:
    - '[[record-20261026-234500-60519]]'
  reference:
    - '[[60518-preserve-runtime-state-during-recovery]]'
    - https://github.com/calan-co/doc-vader/pull/118
tags:
  - afk
  - runtime
  - records
  - historical-merge
---

## Goal

Allow an active current claim to record CI or review evidence for exactly one
already-published historical merge after verifying the linked PR, immutable
commit, published ref, and complete changed-file manifest.

## Tasks

- [x] Add bounded historical-evidence recording with exact-manifest verification.
- [x] Cover accepted and rejected evidence paths with focused command tests.
- [x] Validate typecheck, focused tests, build, and the full suite.

## Acceptance Criteria

- [x] Historical evidence mode excludes only the verified historical manifest from the current lock audit.
- [x] Historical CI/review records bind the work item, PR URL, resolved commit, published ref, and manifest.
- [x] Ordinary record behavior and active-claim checks remain fail closed.
- [x] Foreign PRs, commits, evidence, and manifest paths are rejected.
