---
id: wi-60367
title: Claim Prune and Rm
summary: Implement claim-scoped cleanup for terminal expired claims and their locks without mutating execution history.
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 4
actual: 4
completed_date: '2026-06-21'
links:
  depends_on:
    - '[[60364-atomic-claim-and-lock-acquisition]]'
    - '[[60365-task-halt-command]]'
  reference:
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
  evidence:
    - '[[task-record-preflight]]'
    - '[[record-sandcastle-task-validation-passed]]'
tags:
  - afk
  - runtime
  - claims
  - recovery
---

## Goal

Handle expired claims deterministically without silently making their locked artifacts available or letting cleanup commands mutate execution history.

## Background

An expired claim remains live and blocking until it reaches terminal execution state and is explicitly pruned or removed. `dv claim halt --filter <time-filter> --reason expired` finalizes expired running claims. `dv claim prune` and `dv claim rm` are cleanup-only and never append execution-log entries.

## Tasks

- [x] Expose derived claim state from `expires_at` through the centralized runtime query surface.
- [x] Keep expired claims and locks live and blocking.
- [x] Add `dv claim prune --filter <time-filter>` for terminal expired claim cleanup.
- [x] Add `dv claim rm <claim-token>` for one terminal or expired claim.
- [x] Ensure cleanup deletes owned locks with the claim.
- [x] Ensure cleanup never mutates `execution_log`.
- [x] Ensure cleanup cannot delete running claims or foreign locks.
- [x] Add structured diagnostics for expired-claim cleanup requirements.

## Deliverables

- Expiry derivation helper or view.
- Claim cleanup commands.
- Tests for expired blocking, cleanup, and logging.

## Acceptance criteria

- [x] Past-due claims hydrate as `expired` before lock decisions.
- [x] Expired claims block lock acquisition until halted and cleaned up.
- [x] `ready` does not query, delete, or prune expired runtime rows.
- [x] Cleanup deletes only terminal expired claims and their owned locks.
- [x] `prune` and `rm` do not append or alter execution-log entries.
- [x] Cleanup is idempotent and fails closed on inconsistent lock ownership.

## Blocked by

- [[60364-atomic-claim-and-lock-acquisition]]
- [[60365-task-halt-command]]
