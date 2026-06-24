---
id: wi-60366
title: Authoritative Changed File Lock Audit
summary: Add a Git changed-file audit that terminal success and lifecycle commands must pass before evidence recording, completion, or closure.
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: critical
estimated: 5
actual: 5
completed_date: '2026-06-21'
links:
  depends_on:
    - '[[60364-atomic-claim-and-lock-acquisition]]'
    - '[[60374-lock-command-surface]]'
    - '[[60375-lock-path-normalization-and-rename-gate]]'
  reference:
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
  evidence:
    - '[[task-record-preflight]]'
    - '[[record-sandcastle-task-validation-passed]]'
tags:
  - afk
  - runtime
  - git
  - locks
  - validation
---

## Goal

Make changed-file lock checks an authoritative `dv task` lifecycle gate rather than relying on advisory Git hooks or agent instructions.

## Background

Git hooks can be bypassed with `--no-verify`, and neither hooks nor `AGENTS.md` can prevent arbitrary live filesystem writes. The deterministic enforcement point is the Doc-Vader lifecycle command that records evidence, recovers, completes execution, or closes work.

## Tasks

- [x] Implement a changed-file audit for the current Git worktree or sandbox.
- [x] Normalize changed paths to file artifact keys.
- [x] Compute changed paths from the current branch/worktree diff against the configured merge target.
- [x] Verify every changed path is covered by an active lock owned by the current `claim_token`.
- [x] Wire the audit into `record`, `complete`, `close`, and successful recovery paths.
- [x] Add freshness and mergeability checks against the configured merge target before terminal success and close/finalization.
- [x] Reject Git-detected renames, including case-only renames, with structured diagnostics.
- [x] Keep hooks advisory by allowing them to call the same audit without becoming the authority.
- [x] Return structured diagnostics for unlocked, expired, missing, or foreign locks.
- [x] Ensure `halt` can record audit failures without requiring the audit to pass.

## Deliverables

- Changed-file lock audit API.
- Lifecycle command integration.
- Structured diagnostics for audit failures.
- Tests covering hook bypass assumptions and lifecycle enforcement.

## Acceptance criteria

- [x] `record`, `complete`, and `close` fail closed when changed paths are not covered by the current claim locks.
- [x] Terminal success fails closed when the branch is stale or not mergeable with the configured merge target.
- [x] Terminal success fails closed on detected renames.
- [x] `--no-verify` cannot bypass lifecycle command checks.
- [x] `halt` can proceed when the audit fails and records the failing paths.
- [x] Audit output identifies path, expected claim token, actual lock state, and recommended next command.
- [x] Advisory hook integration, if added, delegates to the same audit implementation.

## Blocked by

- [[60364-atomic-claim-and-lock-acquisition]]
- [[60374-lock-command-surface]]
- [[60375-lock-path-normalization-and-rename-gate]]
