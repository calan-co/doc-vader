---
id: wi-60395
title: Graph-Backed Work List Tracer
summary: Migrate dv work list and dv wi list to read Work Items from graph projection while preserving output.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 4
completed_date: '2026-06-26'
links:
  depends_on:
    - '[[60393-read-only-work-graph-explorer-cli]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
  evidence:
    - '[[record-20260701-032943-60395]]'
tags:
  - afk
  - cli
  - graph
  - work-management
---

## Goal

Make `dv work list` and `dv wi list` use the projected Work graph as their
read model while preserving the current user-facing list output contract.

## Background

The PRD chooses list as the first graph-backed non-mutating Work command
because it only needs WorkItem nodes, filtering, and stable ordering. This is
the lowest-risk migration step before relationship rendering and readiness
selection move to graph-backed behavior.

This work must not migrate `status`, `prompt`, `claim`, `recover`, or `record`.

## What to build

Refactor the Work list command path so Work Item selection comes from graph
projection. Preserve existing text and JSON output fields unless a current
field is impossible to preserve; in that case, document the reason and add a
compatibility test that makes the change explicit.

## Tasks

- [x] Locate the current `dv task list`, `dv work list`, or `dv wi list`
      implementation path.
- [x] Add a graph-backed WorkItem node query for list selection.
- [x] Preserve existing filters, ordering, and output fields.
- [x] Keep deprecated `dv task list` compatibility behavior working during the
      migration window.
- [x] Ensure non-projectable documents do not affect list output.
- [x] Add regression tests comparing legacy list expectations to graph-backed
      results.
- [x] Avoid migrating unrelated Work commands in this slice.

## Deliverables

- Graph-backed list read model for `dv work list` and `dv wi list`.
- Compatibility coverage for legacy list output and aliases.
- Tests proving non-projectable documents are ignored by list selection.

## Acceptance Criteria

- [x] `dv wi list` selects Work Items from projected WorkItem nodes.
- [x] `dv work list` has equivalent behavior to `dv wi list`.
- [x] Existing list text output remains stable.
- [x] Existing list JSON output remains stable or any intentional difference is
      documented and tested.
- [x] Deprecated `dv task list` compatibility remains intact if it currently
      exists.
- [x] `dv wi list` is not affected by valid non-projectable documents.
- [x] No mutation or runtime claim behavior is introduced.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60393-read-only-work-graph-explorer-cli]]

## Relationships

- `depends_on`: `[[60393-read-only-work-graph-explorer-cli]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]`
