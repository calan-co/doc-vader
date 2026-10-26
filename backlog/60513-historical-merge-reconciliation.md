---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60513
title: Historical Merge Reconciliation Closure
summary: Add a fail-closed CLI path to reconcile verified work merged before runtime claim locks existed.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 3
actual: 3
completed_date: '2026-10-25'
links:
  evidence:
    - '[[record-wi-60513-node22-node24]]'
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/115
tags:
  - afk
  - runtime
  - reconciliation
  - historical-merge
---

## Goal

Close historically merged Work Items only when immutable commit ancestry, linked PR, CI/review evidence, and exact changed-file attribution all verify without retroactive locks.

## Tasks

- [x] Add public CLI and regression coverage for historical-merge reconciliation.
- [x] Enforce policy-backed ancestry, evidence, and changed-file checks.
- [x] Validate Node 22/24 coverage and publish a reviewed pull request.

## Deliverables

- A fail-closed `dv work reconcile-merged` command.
- Regression coverage for unverified evidence and unattributed changed files.

## Acceptance Criteria

- [x] The command never creates or accepts retroactive claim locks.
- [x] A linked immutable PR commit must be an ancestor of the named published ref.
- [x] CI and review records must be linked to the Work Item and the immutable PR commit.
- [x] Every changed file must be explicitly attributed, with no foreign paths accepted.
