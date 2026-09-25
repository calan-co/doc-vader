---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60500
title: Enforce Work-Item Completion Before Merge
summary: Prevent implementation pull requests from merging while their attributable Work item has unchecked delivery or acceptance criteria.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 3
actual: 3
completed_date: '2026-09-22'
links:
  reference:
    - '[[60498-initialize-doc-pack-workspaces.md]]'
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/96
  evidence:
    - https://github.com/calan-co/doc-vader/pull/96
    - '[[record-20260925-170206-60500]]'
tags:
  - afk
  - work
  - automation
  - governance
  - ci
---

# Enforce Work-Item Completion Before Merge

## Goal

Make Work-item completion a deterministic merge gate: an implementation pull
request attributable to a Work item must not merge until that item records all
completed delivery and acceptance criteria through the governed lifecycle.

## Background

PR #95 merged the completed `dv init` implementation while `wi-60498` remained
`ready` with every task and acceptance checkbox unchecked. Existing validation
checks only changed backlog Markdown files in `ready-for-review` or `closed`
states. Post-merge automation also ignores `ready` items and could not associate
PR #95 because the Work item has no `links.pull_requests` link and the PR title
and commits did not name `wi-60498`.

The result is a false-positive green merge: CI proves code quality but not that
canonical Work state reflects delivered scope. The gate must use an unambiguous,
repository-owned PR-to-Work-item association and fail before merge rather than
trying to repair a missed transition afterward.

## Tasks

- [x] Define and document one deterministic PR-to-Work-item association accepted
      by CI and automation, including the policy for changes that need no Work
      item.
- [x] Add a required pre-merge CI gate that rejects an attributable Work item
      unless all Tasks and Acceptance Criteria are checked and its completion
      lifecycle/evidence fields are valid.
- [x] Make pre-push validation apply completion-checklist validation to changed
      completed Work items before they can be pushed.
- [x] Update post-merge detection to fail loudly for a matched item still in a
      non-complete lifecycle state.
- [x] Add focused tests covering #95's missed-ready-state path, a valid completed
      item, no-Work-item policy, and malformed or ambiguous association.
- [x] Finalize `wi-60498` through the governed lifecycle after the gate and its
      evidence are in place.

## Deliverables

- One documented, deterministic association rule and no silent association
  fallback.
- Required CI and pre-push enforcement for completion checklists and lifecycle
  evidence.
- Post-merge detection that makes any bypass visible.
- Focused regression coverage and finalized `wi-60498` closure evidence.

## Acceptance Criteria

- [x] An implementation PR with an associated Work item cannot merge while any
      Task or Acceptance Criterion remains unchecked.
- [x] The gate rejects missing, malformed, or ambiguous Work-item association
      before merge, except for the documented documentation-only policy.
- [x] A completed Work item requires valid completion evidence and lifecycle
      fields, not checkboxes alone.
- [x] CI validates association and completion while pre-push validates changed
      completed-item checklists.
- [x] Post-merge automation reports a matched item that remains non-complete.
- [x] Focused tests, typecheck, docs lint, backlog validation, and diff checks
      pass.
