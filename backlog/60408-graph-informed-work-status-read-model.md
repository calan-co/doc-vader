---
id: wi-60408
title: Graph-Informed Work Status Read Model
summary: Enrich Work status output with graph facts and diagnostics while preserving runtime and git authority.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 5
completed_date: '2026-06-29'
links:
  depends_on:
    - '[[60406-immutable-work-command-inventory-and-parity-harness]]'
    - '[[60398-graph-informed-work-ready-migration]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-immutable-command-graph-migration-prd.md]]'
  evidence:
    - '[[task-record-preflight|2026-06-29: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.]]'
    - '[[record-20260701-054004-60408]]'
tags:
  - afk
  - cli
  - graph
  - work-management
---

## Goal

Make `dv work status`, `dv wi status`, and compatibility aliases graph-informed
for relationship and projection diagnostics while keeping runtime sqlite and git
state authoritative for operational status.

## Notes

- 2026-06-29: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.

## Background

Status is read-only but operationally sensitive. It combines canonical Work Item
state, runtime readiness, claim and lock state, git worktree diagnostics, and
recovery guidance. The graph can enrich status output with formal relationships
and projection diagnostics, but it must not decide runtime readiness or mutate
state.

This work must not change recover, claim, lock, or lifecycle transition
behavior.

## What to build

Add graph-informed status facts behind the existing status command contract.
Formal relationship edges may be displayed or included in JSON as inspection
facts. Informational edges and unresolved observations may appear only as
diagnostics or review metadata. Runtime and git-derived fields must remain
authoritative.

## Tasks

- [x] Reuse the parity harness from `wi-60406`.
- [x] Locate status model loading, runtime readiness, and recovery diagnostic
      paths.
- [x] Add graph-derived formal relationship facts to status output where useful.
- [x] Add projection diagnostics without changing runtime readiness decisions.
- [x] Prove informational edges do not affect operational status, recovery, or
      claimability.
- [x] Preserve JSON schema version and existing output fields unless an
      intentional addition is documented and tested.
- [x] Add read-only safety coverage for status execution.

## Deliverables

- Graph-informed Work status output.
- Tests preserving runtime and git authority.
- Tests proving informational edges are diagnostic-only for status.

## Acceptance Criteria

- [x] Status output can include graph-derived formal relationship facts.
- [x] Projection diagnostics are visible in a deterministic location if added.
- [x] Runtime readiness remains sourced from runtime sqlite and execution logs.
- [x] Git worktree and recovery diagnostics remain sourced from git/runtime
      state.
- [x] Informational edges do not affect readiness, recovery, claimability, or
      lifecycle interpretation.
- [x] Existing status output remains stable except for documented, test-covered
      additions.
- [x] No mutation or runtime claim behavior is introduced.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `doc-vader backlog validate --dir backlog --fail-on error`.

## Blocked by

- [[60406-immutable-work-command-inventory-and-parity-harness]]
- [[60398-graph-informed-work-ready-migration]]

## Relationships

- `depends_on`: `[[60406-immutable-work-command-inventory-and-parity-harness]]`
- `depends_on`: `[[60398-graph-informed-work-ready-migration]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-immutable-command-graph-migration-prd.md]]`
