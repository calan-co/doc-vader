---
id: wi-60395
title: Graph-Backed Work List Tracer
summary: Migrate dv work list and dv wi list to read Work Items from graph projection while preserving output.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: high
estimated: 4
links:
  depends_on:
    - '[[60393-read-only-work-graph-explorer-cli]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
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

- [ ] Locate the current `dv task list`, `dv work list`, or `dv wi list`
      implementation path.
- [ ] Add a graph-backed WorkItem node query for list selection.
- [ ] Preserve existing filters, ordering, and output fields.
- [ ] Keep deprecated `dv task list` compatibility behavior working during the
      migration window.
- [ ] Ensure non-projectable documents do not affect list output.
- [ ] Add regression tests comparing legacy list expectations to graph-backed
      results.
- [ ] Avoid migrating unrelated Work commands in this slice.

## Deliverables

- Graph-backed list read model for `dv work list` and `dv wi list`.
- Compatibility coverage for legacy list output and aliases.
- Tests proving non-projectable documents are ignored by list selection.

## Acceptance Criteria

- [ ] `dv wi list` selects Work Items from projected WorkItem nodes.
- [ ] `dv work list` has equivalent behavior to `dv wi list`.
- [ ] Existing list text output remains stable.
- [ ] Existing list JSON output remains stable or any intentional difference is
      documented and tested.
- [ ] Deprecated `dv task list` compatibility remains intact if it currently
      exists.
- [ ] `dv wi list` is not affected by valid non-projectable documents.
- [ ] No mutation or runtime claim behavior is introduced.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60393-read-only-work-graph-explorer-cli]]

## Relationships

- `depends_on`: `[[60393-read-only-work-graph-explorer-cli]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]`
