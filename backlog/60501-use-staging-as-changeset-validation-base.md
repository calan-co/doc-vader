---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60501
title: Use Staging as Changeset Validation Base
summary: Align changeset validation with the staging integration branch and make the trusted Work-item merge gate read current pull request metadata.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 2
actual: 2
completed_date: '2026-09-25'
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/97
  evidence:
    - https://github.com/calan-co/doc-vader/pull/97
    - '[[record-20260925-212626-60501]]'
tags:
  - ci
  - changesets
  - governance
---

## Goal

Validate changesets against the staging integration branch and keep the trusted
Work-item merge gate aligned with current pull request metadata.

## Background

PR #97 changes the changeset validation base from `main` to `staging`. During
its rebase, GitHub's event payload retained an earlier synthetic merge commit,
so the required gate failed before it could evaluate the current pull request.

## Tasks

- [x] Use `staging` as the changeset validation base and cover the behavior.
- [x] Read current pull request metadata before validating the trusted merge
  tree.
- [x] Link this Work item to PR #97 with completion evidence.

## Deliverables

- Changeset validation targets `staging`.
- The trusted gate preserves fail-closed merge-tree validation while avoiding
  stale event metadata.
- A completed Work item links the implementation pull request.

## Acceptance Criteria

- [x] Changeset validation uses `staging` as its base branch.
- [x] The trusted gate fetches current pull request metadata before it validates
  the merge tree.
- [x] The Work item is completed, linked to PR #97, and has completion evidence.
- [x] Focused tests, typecheck, documentation lint, backlog validation, and
  diff checks pass.
