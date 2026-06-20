---
id: wi-60368
title: Fail Closed Ready List Show
summary: Compose work-item state and latest execution-log state in task ready/list/show output so selection fails closed without coupling normal ready selection to live claims or locks.
type: work-item
subtype: story
lifecycle: active
status: ready
status_reason: prioritized
priority: critical
estimated: 5
links:
  depends_on:
    - '[[60363-runtime-entity-schemas]]'
    - '[[60364-atomic-claim-and-lock-acquisition]]'
    - '[[60367-claim-prune-and-rm]]'
  reference:
    - '[[60356-fail-closed-ready-selection-cli]]'
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
  evidence:
    - '[[record-20260620-022741-60368]]'
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

- [ ] Load latest execution log state for each task candidate.
- [ ] Keep live claim and lock hydration out of normal ready selection; use those rows in claim, lock, audit, recovery, and lifecycle paths.
- [ ] Exclude tasks whose Markdown state is not ready.
- [ ] Exclude tasks whose latest execution entry is not `completed/success`.
- [ ] Treat tasks with no execution log entry as execution-ready when Markdown is AFK-ready.
- [ ] Report source disagreements in `list`, `show`, and status JSON.
- [ ] Ensure an execution `completed` state does not complete or close the work item.
- [ ] Preserve deterministic exclusion reasons for Sandcastle consumers.

## Deliverables

- Composed readiness evaluator.
- Updated `dv task ready`, list, show, or status output.
- Tests for Markdown/runtime disagreement.

## Acceptance criteria

- [ ] A task is ready only when Markdown state is AFK-ready and latest execution log is ready-permitting.
- [ ] Active live claims or locks do not become implicit ready-selection inputs; conflicts are enforced when a claim or lock is created.
- [ ] Markdown blockers exclude tasks even when execution state is clear.
- [ ] Execution blockers exclude tasks even when Markdown says ready.
- [ ] Source disagreement is visible in machine-readable output.
- [ ] Execution completion is reported but never treated as work-item completion.

## Blocked by

- [[60363-runtime-entity-schemas]]
- [[60364-atomic-claim-and-lock-acquisition]]
- [[60367-claim-prune-and-rm]]
