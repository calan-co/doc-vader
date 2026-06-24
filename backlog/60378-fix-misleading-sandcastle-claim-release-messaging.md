---
id: wi-60378
title: Fix Misleading Sandcastle Claim Release Messaging
summary: Clarify Sandcastle claim-release logs so no-commit cleanup and post-merge claim release cannot be confused during incident review.
type: work-item
subtype: bug
lifecycle: active
status: completed
status_reason: completed
priority: medium
estimated: 2
actual: 2
completed_date: '2026-06-20'
links:
  reference:
    - '[[60370-sandcastle-local-multi-agent-flow]]'
  evidence:
    - '[[task-record-preflight]]'
    - '[[record-sandcastle-task-validation-passed]]'
tags:
  - afk
  - sandcastle
  - observability
  - bug
---

## Goal

Make Sandcastle claim-release log messages accurately describe why a claim was released.

## Background

During an iteration that successfully merged and closed `wi-60377`, the host
orchestrator printed `Released claim for 60377 after no-commit implementation.`
That message is misleading when claim release happens after host merge and task
completion. It makes incident review look like Sandcastle deleted a branch
despite no commits, even when the branch was already safely merged into host
`HEAD`.

The behavior appears correct: branch deletion is guarded by Git ancestry and task
completion checks. The bug is the observability text. Sandcastle should preserve
the current release behavior while emitting context-specific messages for
no-commit cleanup and post-merge cleanup.

## Tasks

- [x] Find every caller of the Sandcastle claim-release helper.
- [x] Split or parameterize release logging by release context.
- [x] Emit a no-commit message only when implementation produced no branch commits.
- [x] Emit a post-merge message only after host task completion or closure is confirmed.
- [x] Include task id and branch name in release logs where the caller has both values.
- [x] Preserve current claim release, branch deletion, and task closure behavior.
- [x] Add focused test coverage if the release helper has a practical unit seam.
- [x] If no practical test seam exists, document the manual validation command and expected log text in the work item evidence.

## Deliverables

- Clear Sandcastle claim-release log messages for no-commit and post-merge paths.
- Focused test or documented manual validation evidence.
- No behavior change to claim release, branch cleanup, merge, or work-item closure.

## Acceptance criteria

- [x] No-commit cleanup logs state that the claim was released because no branch commits exist.
- [x] Post-merge cleanup logs state that the claim was released after host task completion.
- [x] Logs include task id and branch when that context is available.
- [x] Existing claim release behavior is unchanged.
- [x] Existing safe branch deletion behavior is unchanged.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `pnpm run backlog:validate`.

## Relationships

- `reference`: `[[60370-sandcastle-local-multi-agent-flow]]`
