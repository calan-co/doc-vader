---
id: wi-60370
title: Sandcastle Local Multi Agent Flow
summary: Update the Sandcastle dogfood flow to use SQLite-backed claims, file locks, halt, recover, and lifecycle lock audits.
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: critical
estimated: 5
actual: 5
completed_date: '2026-06-22'
links:
  depends_on:
    - '[[60364-atomic-claim-and-lock-acquisition]]'
    - '[[60365-task-halt-command]]'
    - '[[60368-fail-closed-ready-list-show]]'
    - '[[60369-task-recover-command]]'
    - '[[60373-claim-command-surface]]'
    - '[[60374-lock-command-surface]]'
  reference:
    - '[[60358-sandcastle-dogfood-adapter-flow]]'
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
    - '[[60375-lock-path-normalization-and-rename-gate]]'
  evidence:
    - '[[record-20260624-234349-60370]]'
tags:
  - afk
  - sandcastle
  - runtime
  - multi-agent
---

## Goal

Make the Sandcastle dogfood adapter and guidance use the local multi-agent runtime model instead of single-agent local claim assumptions.

## Background

Multiple local agents may work concurrently through one shared runtime authority, but each execution must claim before work, acquire locks before mutation, and pass lifecycle command audits before terminal success or completion. Normal lock contention uses structured diagnostics, `halt`, and `recover`, not HITL.

## Tasks

- [x] Update Sandcastle-facing guidance to claim before execution.
- [x] Add guidance for lazy file lock acquisition with `dv lock create --claim <claim-token>`.
- [x] Add guidance for good-citizen lock cleanup with `dv lock rm --claim <claim-token>` only for unmodified resources.
- [x] Ensure non-Doc-Vader writes are checked by lifecycle audits before record or completion.
- [x] Route unrecoverable lock conflicts to `dv claim halt <claim-token> --reason conflict`.
- [x] Route blocked halted tasks back through the recovery command.
- [x] Keep terminal claim completion behind existing validation and evidence gates.
- [x] Remove or supersede guidance that treats hooks or prompt instructions as deterministic enforcement.

## Deliverables

- [x] Updated Sandcastle adapter or guidance.
- [x] Multi-agent dogfood command flow.
- [x] Integration fixture for two local agents.

## Acceptance criteria

- [x] Two local Sandcastle agents can claim different eligible tasks concurrently.
- [x] Same-file conflict produces structured diagnostics and can be halted without relying on HITL.
- [x] Ready selection excludes halted tasks through latest execution log.
- [x] Recovery returns a halted task to ready only after safety checks pass.
- [x] Sandcastle flow does not rely on Git hooks as the authoritative enforcement boundary.

## Blocked by

- [[60364-atomic-claim-and-lock-acquisition]]
- [[60365-task-halt-command]]
- [[60368-fail-closed-ready-list-show]]
- [[60369-task-recover-command]]
- [[60373-claim-command-surface]]
- [[60374-lock-command-surface]]
- [[60375-lock-path-normalization-and-rename-gate]]
