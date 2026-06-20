---
id: wi-60372
title: Supersede Single Agent MVP Items
summary: Reconcile prior single-agent Sandcastle MVP backlog items with the new Git and SQLite local multi-agent successor set.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: prioritized
priority: medium
estimated: 3
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
    - '[[record-20260620-022741-60372]]'
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

- [ ] Review existing Sandcastle MVP items for single-agent assumptions.
- [ ] Identify which completed behavior remains valid.
- [ ] Mark outdated assumptions as superseded, narrowed, or successor-linked without deleting historical context.
- [ ] Add references from old items to the successor runtime contract where appropriate.
- [ ] Include the claim command, lock command, and path normalization successor slices in traceability updates.
- [ ] Mark scope graph reservation and claim-bound artifact reservation items as deferred future architecture rather than MVP dependencies.
- [ ] Link successor work to the storage and format adapter seam where runtime persistence or artifact parsing is involved.
- [ ] Preserve existing evidence and PR links.
- [ ] Run backlog validation after any updates.

## Deliverables

- Updated backlog traceability for the Sandcastle MVP successor path.
- Clear successor links from older dogfood items to the Git + SQLite runtime items.
- Validation evidence for the cleanup.

## Acceptance criteria

- [ ] Prior single-agent assumptions no longer appear as the current implementation plan.
- [ ] Prior scope-graph and claim-bound artifact reservation assumptions no longer appear as MVP blockers.
- [ ] Completed prior slices retain their historical evidence.
- [ ] New successor items are discoverable from old Sandcastle MVP items.
- [ ] No archived or active item is deleted.
- [ ] `pnpm run backlog:validate` passes after the cleanup.

## Blocked by

- [[60361-git-sqlite-local-multi-agent-runtime-contract]]
