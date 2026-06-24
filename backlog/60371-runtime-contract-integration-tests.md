---
id: wi-60371
title: Runtime Contract Integration Tests
summary: Add end-to-end tests proving the Git and SQLite local runtime contract is safe for local multi-agent AFK execution.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 5
actual: 5
completed_date: '2026-06-22'
links:
  depends_on:
    - '[[60362-runtime-sqlite-store-and-migrations]]'
    - '[[60363-runtime-entity-schemas]]'
    - '[[60364-atomic-claim-and-lock-acquisition]]'
    - '[[60365-task-halt-command]]'
    - '[[60366-authoritative-changed-file-lock-audit]]'
    - '[[60367-claim-prune-and-rm]]'
    - '[[60368-fail-closed-ready-list-show]]'
    - '[[60369-task-recover-command]]'
    - '[[60370-sandcastle-local-multi-agent-flow]]'
    - '[[60373-claim-command-surface]]'
    - '[[60374-lock-command-surface]]'
    - '[[60375-lock-path-normalization-and-rename-gate]]'
  reference:
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
  evidence:
    - '[[record-wi-60371-validation]]'
tags:
  - afk
  - runtime
  - tests
  - multi-agent
---

## Goal

Prove the local multi-agent runtime contract through command-level and integration tests.

## Background

The runtime model depends on transactionality, fail-closed selection, and lifecycle command audits. Focused tests are needed at the CLI and runtime seams because prompt instructions and hooks are not authoritative enforcement.

## Tasks

- [x] Test concurrent initial lock conflict leaves no leaked claim or lock rows.
- [x] Test mid-execution lazy lock conflict returns structured diagnostics without partial lock state.
- [x] Test changed-file audit blocks record and completion with unlocked changed paths.
- [x] Test `halt` records dirty and unlocked paths while removing runtime ownership.
- [x] Test expired claims block lock acquisition until `halt --reason expired` and cleanup.
- [x] Test ready composition over Markdown and latest execution log only.
- [x] Test recovery returns halted tasks to `ready/recoverable`.
- [x] Test `--force clean` and `--force resync` reject unrelated dirty paths.
- [x] Test SQLite rollback prevents partial runtime state.
- [x] Test terminal success requires branch freshness, mergeability, and cumulative diff lock coverage.
- [x] Test Git-detected renames fail terminal success.

## Deliverables

- Runtime unit tests.
- CLI integration tests.
- Sandcastle flow fixture for local multi-agent behavior.

## Acceptance criteria

- [x] Tests fail if locks or claims leak after failed acquisition.
- [x] Tests fail if lifecycle commands can advance with unlocked changed files.
- [x] Tests fail if `ready` ignores halted or failed execution-log state.
- [x] Tests fail if recovery bypasses normal claim and lock ownership.
- [x] Tests cover both successful and conflicting multi-agent flows.

## Blocked by

- [[60362-runtime-sqlite-store-and-migrations]]
- [[60363-runtime-entity-schemas]]
- [[60364-atomic-claim-and-lock-acquisition]]
- [[60365-task-halt-command]]
- [[60366-authoritative-changed-file-lock-audit]]
- [[60367-claim-prune-and-rm]]
- [[60368-fail-closed-ready-list-show]]
- [[60369-task-recover-command]]
- [[60370-sandcastle-local-multi-agent-flow]]
- [[60373-claim-command-surface]]
- [[60374-lock-command-surface]]
- [[60375-lock-path-normalization-and-rename-gate]]
