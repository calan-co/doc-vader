---
id: wi-60364
title: Atomic Claim and Lock Acquisition
summary: Implement transactional execution creation, claim acquisition, initial file locks, and lock-conflict halt logging.
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: critical
estimated: 6
actual: 6
completed_date: '2026-06-20'
links:
  depends_on:
    - '[[60362-runtime-sqlite-store-and-migrations]]'
    - '[[60363-runtime-entity-schemas]]'
    - '[[60375-lock-path-normalization-and-rename-gate]]'
  reference:
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
  evidence:
    - '[[task-record-preflight]]'
    - '[[record-sandcastle-task-validation-passed]]'
tags:
  - afk
  - runtime
  - claims
  - locks
  - multi-agent
---

## Goal

Make task execution ownership and file-level artifact locks atomic so local agents cannot partially acquire runtime state.

## Background

Every execution attempt is represented by a `claim_token`. A claim is the live ownership record for that attempt, and every mutable file artifact must have a lock owned by that claim before terminal success. Claim creation may start with zero locks; lazy lock acquisition covers discovered mutation targets. Initial acquisition should either create all requested live state or leave no live claim or lock behind.

## Tasks

- [x] Generate a `claim_token` from the canonical static claim record before claim acquisition.
- [x] Insert claim, optional initial locks, and the first `running/started` execution log entry in one SQLite transaction.
- [x] Allow claim creation with zero initial locks.
- [x] Normalize file paths to repo-relative artifact paths and stable SHA-256 lock keys.
- [x] Detect initial lock conflicts using the live `locks` table.
- [x] On initial lock conflict, insert a `halted/conflict` execution log entry with the attempted `claim_token`, but no live claim or locks.
- [x] Support mid-execution lazy lock acquisition for newly discovered files.
- [x] On lazy lock conflict, return structured diagnostics without automatically halting the claim.
- [x] Avoid waiting or retrying when a write lock is already registered.

## Deliverables

- Atomic claim and initial lock acquisition API.
- Lazy lock acquisition API.
- Lock conflict reporting and execution log entries.
- Tests for rollback and conflict behavior.

## Acceptance criteria

- [x] Successful acquisition creates one claim, all requested locks, and one `running` execution entry atomically.
- [x] Failed initial acquisition leaves no live claim or lock rows.
- [x] Failed initial acquisition still records task-level execution history.
- [x] Mid-execution lock conflicts do not mutate runtime state beyond structured diagnostics.
- [x] Lock conflict details include the locked path, owning claim token, owning target, and derived expiry state where available.

## Blocked by

- [[60362-runtime-sqlite-store-and-migrations]]
- [[60363-runtime-entity-schemas]]
- [[60375-lock-path-normalization-and-rename-gate]]
