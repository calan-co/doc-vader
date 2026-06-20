---
id: wi-60367
title: Claim Prune and Rm
summary: Implement claim-scoped cleanup for terminal expired claims and their locks without mutating execution history.
type: work-item
subtype: story
lifecycle: active
status: ready
status_reason: prioritized
priority: high
estimated: 4
links:
  depends_on:
    - '[[60364-atomic-claim-and-lock-acquisition]]'
    - '[[60365-task-halt-command]]'
  reference:
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
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

- [ ] Expose derived claim state from `expires_at` through the centralized runtime query surface.
- [ ] Keep expired claims and locks live and blocking.
- [ ] Add `dv claim prune --filter <time-filter>` for terminal expired claim cleanup.
- [ ] Add `dv claim rm <claim-token>` for one terminal or expired claim.
- [ ] Ensure cleanup deletes owned locks with the claim.
- [ ] Ensure cleanup never mutates `execution_log`.
- [ ] Ensure cleanup cannot delete running claims or foreign locks.
- [ ] Add structured diagnostics for expired-claim cleanup requirements.

## Deliverables

- Expiry derivation helper or view.
- Claim cleanup commands.
- Tests for expired blocking, cleanup, and logging.

## Acceptance criteria

- [ ] Past-due claims hydrate as `expired` before lock decisions.
- [ ] Expired claims block lock acquisition until halted and cleaned up.
- [ ] `ready` does not query, delete, or prune expired runtime rows.
- [ ] Cleanup deletes only terminal expired claims and their owned locks.
- [ ] `prune` and `rm` do not append or alter execution-log entries.
- [ ] Cleanup is idempotent and fails closed on inconsistent lock ownership.

## Blocked by

- [[60364-atomic-claim-and-lock-acquisition]]
- [[60365-task-halt-command]]
