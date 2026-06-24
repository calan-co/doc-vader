---
id: wi-60368
title: Fail Closed Ready List Show
summary: Compose work-item state and latest execution-log state in task ready/list/show output so selection fails closed without coupling normal ready selection to live claims or locks.
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: critical
estimated: 5
actual: 5
completed_date: '2026-06-21'
links:
  depends_on:
    - '[[60363-runtime-entity-schemas]]'
    - '[[60364-atomic-claim-and-lock-acquisition]]'
    - '[[60367-claim-prune-and-rm]]'
  reference:
    - '[[60356-fail-closed-ready-selection-cli]]'
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
tags:
  - afk
  - runtime
  - ready
  - command-surface
---

## Goal

Update task selection and inspection commands so effective readiness is safe when Markdown state and execution-log state disagree.

## Background

The execution log is an additional ready gate, not a replacement for work-item state. `dv task ready` evaluates work-item Markdown and latest execution-log entry only. Live claims and locks are hydrated by claim, lock, audit, recovery, and lifecycle commands, not by normal ready selection.

Architectural context: `docs/architecture/decisions/adr-006-task-command-surface-work-item-canonical-model.md`.

## Tasks

- [x] Load latest execution log state for each task candidate.
- [x] Keep live claim and lock hydration out of normal ready selection; use those rows in claim, lock, audit, recovery, and lifecycle paths.
- [x] Exclude tasks whose Markdown state is not ready.
- [x] Exclude tasks whose latest execution entry is not `completed/success`.
- [x] Treat tasks with no execution log entry as execution-ready when Markdown is AFK-ready.
- [x] Report source disagreements in `list`, `show`, and status JSON.
- [x] Ensure an execution `completed` state does not complete or close the work item.
- [x] Preserve deterministic exclusion reasons for Sandcastle consumers.

## Deliverables

- Composed readiness evaluator.
- Updated `dv task ready`, list, show, or status output.
- Tests for Markdown/runtime disagreement.

## Acceptance criteria

- [x] A task is ready only when Markdown state is AFK-ready and latest execution log is ready-permitting.
- [x] Active live claims or locks do not become implicit ready-selection inputs; conflicts are enforced when a claim or lock is created.
- [x] Markdown blockers exclude tasks even when execution state is clear.
- [x] Execution blockers exclude tasks even when Markdown says ready.
- [x] Source disagreement is visible in machine-readable output.
- [x] Execution completion is reported but never treated as work-item completion.

## Blocked by

- [[60363-runtime-entity-schemas]]
- [[60364-atomic-claim-and-lock-acquisition]]
- [[60367-claim-prune-and-rm]]
