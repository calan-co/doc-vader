---
id: wi-60370
title: Sandcastle Local Multi Agent Flow
summary: Update the Sandcastle dogfood flow to use SQLite-backed claims, file locks, halt, recover, and lifecycle lock audits.
type: work-item
subtype: story
lifecycle: active
status: ready
status_reason: prioritized
priority: critical
estimated: 5
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

- [ ] Update Sandcastle-facing guidance to claim before execution.
- [ ] Add guidance for lazy file lock acquisition with `dv lock create --claim <claim-token>`.
- [ ] Add guidance for good-citizen lock cleanup with `dv lock rm --claim <claim-token>` only for unmodified resources.
- [ ] Ensure non-Doc-Vader writes are checked by lifecycle audits before record or completion.
- [ ] Route unrecoverable lock conflicts to `dv claim halt <claim-token> --reason conflict`.
- [ ] Route blocked halted tasks back through the recovery command.
- [ ] Keep terminal claim completion behind existing validation and evidence gates.
- [ ] Remove or supersede guidance that treats hooks or prompt instructions as deterministic enforcement.

## Deliverables

- Updated Sandcastle adapter or guidance.
- Multi-agent dogfood command flow.
- Integration fixture for two local agents.

## Acceptance criteria

- [ ] Two local Sandcastle agents can claim different eligible tasks concurrently.
- [ ] Same-file conflict produces structured diagnostics and can be halted without relying on HITL.
- [ ] Ready selection excludes halted tasks through latest execution log.
- [ ] Recovery returns a halted task to ready only after safety checks pass.
- [ ] Sandcastle flow does not rely on Git hooks as the authoritative enforcement boundary.

## Blocked by

- [[60364-atomic-claim-and-lock-acquisition]]
- [[60365-task-halt-command]]
- [[60368-fail-closed-ready-list-show]]
- [[60369-task-recover-command]]
- [[60373-claim-command-surface]]
- [[60374-lock-command-surface]]
