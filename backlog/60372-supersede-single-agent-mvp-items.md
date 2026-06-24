---
id: wi-60372
title: Supersede Single Agent MVP Items
summary: Reconcile prior single-agent Sandcastle MVP backlog items with the new Git and SQLite local multi-agent successor set.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: medium
estimated: 3
actual: 3
completed_date: '2026-06-20'
links:
  depends_on:
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
  reference:
    - '[[60356-fail-closed-ready-selection-cli]]'
    - '[[60357-claim-aware-task-record-payload]]'
    - '[[60358-sandcastle-dogfood-adapter-flow]]'
    - '[[60342-task-scope-reservation-and-lookup]]'
    - '[[60344-claim-bound-artifact-reservations]]'
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
    - '[[60373-claim-command-surface]]'
    - '[[60374-lock-command-surface]]'
    - '[[60375-lock-path-normalization-and-rename-gate]]'
  evidence:
    - '[[record-sandcastle-task-validation-passed]]'
tags:
  - afk
  - backlog
  - sandcastle
  - runtime
  - cleanup
---

## Goal

Update backlog traceability so older single-agent/local-claim-lock MVP assumptions are clearly superseded or narrowed by the local multi-agent runtime successor set.

## Background

The approved design moved from a single-agent local claim lock and scope-graph-first reservation model to a Git + SQLite runtime with claim tokens, repo-relative file locks, execution logs, claim transitions, recovery, pruning, and lifecycle audits. Existing work items and records should remain as historical context, but the current implementation path should point to the successor chain and the storage/format adapter seams.

Architectural context: `docs/architecture/decisions/adr-009-storage-and-format-seams.md`.

## Tasks

- [x] Review existing Sandcastle MVP items for single-agent assumptions.
- [x] Identify which completed behavior remains valid.
- [x] Mark outdated assumptions as superseded, narrowed, or successor-linked without deleting historical context.
- [x] Add references from old items to the successor runtime contract where appropriate.
- [x] Include the claim command, lock command, and path normalization successor slices in traceability updates.
- [x] Mark scope graph reservation and claim-bound artifact reservation items as deferred future architecture rather than MVP dependencies.
- [x] Link successor work to the storage and format adapter seam where runtime persistence or artifact parsing is involved.
- [x] Preserve existing evidence and PR links.
- [x] Run backlog validation after any updates.

## Deliverables

- Updated backlog traceability for the Sandcastle MVP successor path.
- Clear successor links from older dogfood items to the Git + SQLite runtime items.
- Validation evidence for the cleanup.

## Acceptance criteria

- [x] Prior single-agent assumptions no longer appear as the current implementation plan.
- [x] Prior scope-graph and claim-bound artifact reservation assumptions no longer appear as MVP blockers.
- [x] Completed prior slices retain their historical evidence.
- [x] New successor items are discoverable from old Sandcastle MVP items.
- [x] No archived or active item is deleted.
- [x] `pnpm run backlog:validate` passes after the cleanup.

## Blocked by

- [[60361-git-sqlite-local-multi-agent-runtime-contract]]
