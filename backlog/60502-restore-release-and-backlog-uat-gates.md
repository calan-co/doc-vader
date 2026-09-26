---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60502
title: Restore Release and Backlog UAT Gates
summary: Restore strict release and backlog automation gates without inventing historical effort data.
type: work-item
subtype: bug
lifecycle: active
status: running
status_reason: remediation
priority: high
links:
  evidence:
    - '[[record-wi-60502-uat-gate-remediation]]'
  reference:
    - '[[60416-end-to-end-sandcastle-smoke-and-recovery]]'
tags:
  - release
  - backlog
  - uat
---

## Goal

Restore green post-merge release and backlog automation gates for the Sandcastle
MVP UAT path without bypassing pre-push validation or fabricating actual effort.

## Plan

1. Permit only the generated Changesets version branch to update `package.json`
   without a new changeset; all other release-relevant files remain strict.
2. Make estimates optional and require `actual` only when an estimate exists.
3. Reclassify historical PR links that are evidence rather than delivery, and
   close the completed CodeRabbit configuration record with evidence.

## Tasks

- [x] Reproduce both post-merge gate failures from GitHub Actions evidence.
- [x] Add failing tests for the generated version branch and optional effort policy.
- [x] Implement the narrow release and work-item policy changes.
- [x] Reconcile stale historical work-item metadata without weakening automation.
- [ ] Validate release, backlog, documentation, and UAT-facing gates.

## Acceptance Criteria

- [x] A generated Changesets version branch accepts only `package.json` as a
  changeset-free release-relevant file.
- [x] Any other release-relevant file still requires a changeset.
- [x] Completed work items without an estimate do not require invented actual effort.
- [x] Completed work items with an estimate still require numeric actual effort.
- [ ] Backlog Automation has no stale linked-work-item errors.
- [ ] Post-merge Release and CI workflows pass on `staging`.
