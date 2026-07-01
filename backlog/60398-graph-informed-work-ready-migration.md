---
id: wi-60398
title: Graph-Informed Work Ready Migration
summary: Migrate dv work ready and dv wi ready to use graph relationships plus derived readiness findings while preserving output.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 5
completed_date: '2026-06-26'
links:
  depends_on:
    - '[[60397-derived-readiness-findings-projection]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
  evidence:
    - '[[record-20260701-032943-60398]]'
tags:
  - afk
  - cli
  - graph
  - readiness
  - work-management
---

## Goal

Make Work ready selection graph-informed while preserving the current command
contract for users and automation.

## Background

`dv wi ready` has higher governance impact than list or show because it selects
work for execution. The command should wait until graph-backed relationship
inspection and derived readiness findings exist. It can then use canonical
relationship edges for durable facts and derived findings for transient blocker
state.

This work must not introduce canonical `blocks` or `relates_to` edges and must
not migrate mutation-adjacent commands such as `claim`, `recover`, or `record`.

## What to build

Refactor `dv work ready` and `dv wi ready` so selection is informed by projected
Work graph relationships and derived readiness findings. Preserve current output
shape, ordering, filters, and failure behavior unless a difference is explicitly
documented and covered by tests.

## Tasks

- [x] Locate the current ready selection path and output contract.
- [x] Use projected WorkItem nodes and `depends_on` edges for dependency-aware
      selection.
- [x] Consume derived readiness findings for dependency, resource, policy, and
      evidence blockers.
- [x] Preserve current text and JSON output contracts where possible.
- [x] Preserve deprecated `dv task ready` compatibility during the migration
      window if it currently exists.
- [x] Add tests comparing legacy ready selection expectations with
      graph-informed output.
- [x] Add tests proving blockers are reported as findings rather than
      relationship edges.
- [x] Avoid migrating `status`, `prompt`, `claim`, `recover`, or `record` in
      this slice.

## Deliverables

- Graph-informed ready selection for `dv work ready` and `dv wi ready`.
- Compatibility tests for output shape, ordering, filters, and aliases.
- Tests proving derived findings drive blocker reporting.

## Acceptance Criteria

- [x] `dv wi ready` uses projected WorkItem nodes for candidate selection.
- [x] `dv wi ready` uses `depends_on` graph edges for dependency evaluation.
- [x] `dv wi ready` excludes or explains unready items through derived
      readiness findings.
- [x] Existing ready output remains stable or intentional differences are
      documented and tested.
- [x] Deprecated `dv task ready` compatibility remains intact if it currently
      exists.
- [x] No canonical `blocks` or `relates_to` edge is emitted or persisted.
- [x] `status`, `prompt`, `claim`, `recover`, and `record` behavior is
      unchanged.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60397-derived-readiness-findings-projection]]

## Relationships

- `depends_on`: `[[60397-derived-readiness-findings-projection]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]`
