---
id: wi-60369
title: Claim Recover Command
summary: Add `dv claim recover --target task:<task-id>` to verify a halted task can safely return to ready using normal claim and lock ownership.
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: critical
estimated: 6
actual: 6
completed_date: '2026-06-21'
links:
  depends_on:
    - '[[60365-task-halt-command]]'
    - '[[60366-authoritative-changed-file-lock-audit]]'
    - '[[60368-fail-closed-ready-list-show]]'
  reference:
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
tags:
  - afk
  - runtime
  - recovery
  - command-surface
---

## Goal

Implement explicit recovery for halted task executions so blocked work can return to `ready/recoverable` only after deterministic safety checks pass.

## Background

Recovery is a normal execution operation, not a privileged bypass. It creates a new claim, uses normal lock acquisition, verifies the worktree and runtime state, appends `completed/success` when recovery succeeds, and transitions the work item through the normal validated path.

## Tasks

- [x] Add `dv claim recover --target task:<task-id> [--json]`.
- [x] Create a new claim through normal claim creation.
- [x] Require normal lock ownership for recovery mutations.
- [x] Verify any latest `halted` execution state is recoverable by current safety checks.
- [x] Verify required locks are clear or acquired by the recovery claim.
- [x] Verify readiness gates still pass: AFK, not HITL, dependencies satisfied, validation clean, and runtime hydration clear.
- [x] Fail by default on dirty worktree state.
- [x] Implement `--force clean` for owned dirty paths after full authority precheck.
- [x] Implement `--force resync` using Doc-Vader checkpoints for owned dirty paths, Git-backed resync, restore, and validation.
- [x] Reject force modes when unrelated dirty paths are present.
- [x] Append `completed/success` when recovery succeeds and transition the work item to `ready/recoverable`.

## Deliverables

- `dv claim recover --target task:<task-id>` command.
- Owned-path authority precheck.
- Doc-Vader checkpoint support for `--force resync`.
- Tests for clean recovery and force modes.

## Acceptance criteria

- [x] Recovery cannot run without normal claim and lock ownership.
- [x] Recovery creates a new claim rather than mutating the old halted attempt.
- [x] Successful recovery returns the work item to `ready/recoverable`.
- [x] Default recovery refuses dirty worktrees.
- [x] `--force clean` and `--force resync` operate only on owned dirty paths.
- [x] Unrelated dirty paths make recovery fail without changes.

## Blocked by

- [[60365-task-halt-command]]
- [[60366-authoritative-changed-file-lock-audit]]
- [[60368-fail-closed-ready-list-show]]
