---
id: wi-60374
title: Lock Command Surface
summary: Implement explicit lock create, rm, and status commands for claim-scoped file mutation ownership.
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: critical
estimated: 4
actual: 4
completed_date: '2026-06-20'
links:
  depends_on:
    - '[[60364-atomic-claim-and-lock-acquisition]]'
    - '[[60375-lock-path-normalization-and-rename-gate]]'
  reference:
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
  evidence:
    - '[[task-record-preflight]]'
    - '[[record-sandcastle-task-validation-passed]]'
tags:
  - afk
  - runtime
  - locks
  - command-surface
---

## Goal

Expose explicit lock commands so agents can safely acquire mutable file ownership before editing files outside Doc-Vader-managed mutations.

## Background

Claims can be created with zero locks. Locks are acquired lazily and atomically as mutation targets become known. `dv lock rm` is a good-citizen cleanup mechanism for unmodified resources, not a way to remove ownership of changed files. MVP locks use the local SQLite storage adapter but expose storage-neutral runtime semantics.

Architectural context: `docs/architecture/decisions/adr-009-storage-and-format-seams.md`.

## Tasks

- [x] Add `dv lock create --claim <claim-token> <path...>`.
- [x] Add `dv lock rm --claim <claim-token> <path...>`.
- [x] Add `dv lock status --claim <claim-token>`.
- [x] Make multi-path create atomic: acquire all requested locks or none.
- [x] Make multi-path rm atomic: remove all requested locks or none.
- [x] Fail `lock rm` when any requested path is modified, missing from the claim, foreign-owned, or otherwise invalid.
- [x] Return structured diagnostics for conflicts without automatically halting the claim.
- [x] Report normalized `path`, `key`, and modified/clean status in lock status output.

## Deliverables

- [x] Lock CLI commands.
- [x] Runtime APIs for atomic lock create and rm.
- [x] Tests for atomicity, modified-path rejection, conflict diagnostics, and status output.

## Acceptance criteria

- [x] Agents can explicitly acquire locks before non-Doc-Vader file edits.
- [x] Lock create never partially succeeds.
- [x] Lock rm never removes modified or foreign-owned locks.
- [x] Lock conflicts do not mutate execution state.
- [x] Lock status shows the claim's current locks with normalized identities.

## Blocked by

- [[60364-atomic-claim-and-lock-acquisition]]
- [[60375-lock-path-normalization-and-rename-gate]]
