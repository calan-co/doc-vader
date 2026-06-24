---
id: wi-60365
title: Claim Halt Command
summary: Add `dv claim halt` to stop an unsafe or blocked execution attempt while preserving structured recovery context and removing runtime ownership.
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: critical
estimated: 5
actual: 5
completed_date: '2026-06-20'
links:
  depends_on:
    - '[[60364-atomic-claim-and-lock-acquisition]]'
  reference:
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
  evidence:
    - '[[task-record-preflight]]'
    - '[[record-sandcastle-task-validation-passed]]'
tags:
  - afk
  - runtime
  - command-surface
  - recovery
---

## Goal

Implement `dv claim halt` as the explicit command for stopping an execution attempt that cannot safely continue.

## Background

`halt` means the execution was intentionally stopped with structured blocker or recovery context. It must be allowed to proceed even when changed-file lock audit or freshness checks fail, because preserving that failure context is the reason the command exists.

## Tasks

- [x] Add `dv claim halt <claim-token> --reason conflict|blocked|invalid|expired|revoked|cancelled`.
- [x] Add `dv claim halt --filter <time-filter> --reason expired` as the only MVP bulk transition.
- [x] Validate reason and any detail code against the runtime schema.
- [x] Enumerate dirty and unlocked changed paths and record them in the execution log.
- [x] Append a terminal `halted` execution log entry.
- [x] Remove owned locks and claim transactionally after the halt entry is written.
- [x] For `reason: conflict` and `code: lock`, attempt to transition the work item to `paused/system` through normal validation.
- [x] Keep the execution log authoritative if Markdown transition fails.
- [x] Ensure halted attempts are terminal; recovery creates a new claim.

## Deliverables

- `dv claim halt` command.
- Runtime API for halting an execution.
- Work-item transition integration for known lock conflicts.
- Tests for halt with clean and dirty worktrees.

## Acceptance criteria

- [x] `halt` records structured recovery details and removes runtime ownership.
- [x] `halt` is not blocked by changed-file lock audit failures.
- [x] Dirty or unlocked changed paths are present in the execution log entry.
- [x] Lock-conflict halts make the task ineligible for ready selection.
- [x] Failed Markdown transition does not erase or roll back the runtime halt record.

## Blocked by

- [[60364-atomic-claim-and-lock-acquisition]]
