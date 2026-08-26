---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60492
title: Add Repository-Owned PR Review-Resolve Status Gate
summary: Publish a repository-owned status from normalized current-head review facts and make permanent protection governance possible after the evaluator is proven.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 5
links:
  depends_on:
    - '[[60491-define-and-validate-current-head-independent-review-evidence.md]]'
tags:
  - ci
  - review
  - policy
  - quality
---

## Goal

Make the ongoing independent review-resolve process mechanically enforceable through a repository-owned pull-request status gate.

## Tasks

- [ ] Normalize pull-request review and thread facts with least-privilege workflow access.
- [ ] Publish the deterministic current-head review-evidence status for substantive pull-request heads.
- [ ] Prove status behavior before proposing a permanent protected-branch required-check change.

## Deliverables

- Repository-owned review-resolve PR workflow or CI entry point.
- Fixture-based API-normalization and workflow contract tests.

## Acceptance Criteria

- [ ] Review facts are bound to the current head and base SHA, and a substantive push invalidates prior artifacts.
- [ ] The status fails for missing evidence, stale reports, or unresolved findings and passes for clean current-head evidence.
- [ ] Workflow permissions are least privilege and API normalization is covered by fixtures.
- [ ] Any later required-check policy change is separate governed branch-protection work.
