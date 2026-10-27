---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60520
title: Admin-Gated Direct-Push Historical Reconciliation
summary: Add a disabled-by-default, repository-admin-verified direct-push source for historical Work reconciliation.
type: work-item
subtype: feature
lifecycle: active
status: ready
status_reason: planned
priority: critical
estimated: 1
links:
  reference:
    - https://github.com/calan-co/doc-vader/pull/119
  evidence:
    - '[[record-wi-60520-validation-20261027]]'
tags:
  - afk
  - runtime
  - reconciliation
  - direct-push
  - github
---

## Goal

Support one explicit, disabled-by-default direct-push reconciliation source without weakening merged-PR reconciliation or branch protection.

## Acceptance Criteria

- [ ] The source is unavailable unless a project-local policy explicitly enables it.
- [ ] The command verifies `gh` authentication and that the current viewer has `admin` permission for the configured origin repository.
- [ ] The commit is immutable and reachable from the configured protected ref.
- [ ] The caller supplies the exact changed-file manifest and immutable admin approval/evidence receipt.
- [ ] Missing, failed, foreign, or mismatched verification fails closed.
- [ ] The implementation never creates retroactive locks or changes GitHub branch protection.
- [ ] Regression coverage proves disabled-by-default, valid admin-gated success, and each verification failure.

## Tasks

- [ ] Define the project-local policy schema and CLI contract after PR #119 (WI-60519) merges.
- [ ] Implement source verification and manifest validation.
- [ ] Add public CLI regression coverage.
- [ ] Validate with Node 22/24 suites and independent review.

## Relationships

- `depends_on`: PR #119 / WI-60519 record-verified-historical-merge-evidence (unmerged external prerequisite).
