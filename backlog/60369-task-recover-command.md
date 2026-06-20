---
id: wi-60369
title: Claim Recover Command
summary: Add `dv claim recover --target task:<task-id>` to verify a halted task can safely return to ready using normal claim and lock ownership.
type: work-item
subtype: story
lifecycle: active
status: ready
status_reason: prioritized
priority: critical
estimated: 6
links:
  depends_on:
    - '[[60365-task-halt-command]]'
    - '[[60366-authoritative-changed-file-lock-audit]]'
    - '[[60368-fail-closed-ready-list-show]]'
  reference:
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
  evidence:
    - '[[record-20260620-022741-60369]]'
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

- [ ] Add `dv claim recover --target task:<task-id> [--json]`.
- [ ] Create a new claim through normal claim creation.
- [ ] Require normal lock ownership for recovery mutations.
- [ ] Verify any latest `halted` execution state is recoverable by current safety checks.
- [ ] Verify required locks are clear or acquired by the recovery claim.
- [ ] Verify readiness gates still pass: AFK, not HITL, dependencies satisfied, validation clean, and runtime hydration clear.
- [ ] Fail by default on dirty worktree state.
- [ ] Implement `--force clean` for owned dirty paths after full authority precheck.
- [ ] Implement `--force resync` using Doc-Vader checkpoints for owned dirty paths, Git-backed resync, restore, and validation.
- [ ] Reject force modes when unrelated dirty paths are present.
- [ ] Append `completed/success` when recovery succeeds and transition the work item to `ready/recoverable`.

## Deliverables

- `dv claim recover --target task:<task-id>` command.
- Owned-path authority precheck.
- Doc-Vader checkpoint support for `--force resync`.
- Tests for clean recovery and force modes.

## Acceptance criteria

- [ ] Recovery cannot run without normal claim and lock ownership.
- [ ] Recovery creates a new claim rather than mutating the old halted attempt.
- [ ] Successful recovery returns the work item to `ready/recoverable`.
- [ ] Default recovery refuses dirty worktrees.
- [ ] `--force clean` and `--force resync` operate only on owned dirty paths.
- [ ] Unrelated dirty paths make recovery fail without changes.

## Blocked by

- [[60365-task-halt-command]]
- [[60366-authoritative-changed-file-lock-audit]]
- [[60368-fail-closed-ready-list-show]]
