---
id: wi-60408
title: Graph-Informed Work Status Read Model
summary: Enrich Work status output with graph facts and diagnostics while preserving runtime and git authority.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: high
estimated: 5
links:
  depends_on:
    - "[[60406-immutable-work-command-inventory-and-parity-harness]]"
    - "[[60398-graph-informed-work-ready-migration]]"
  reference:
    - "[[../docs/how-to/implementation-plans/doc-vader-immutable-command-graph-migration-prd.md]]"
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

- [ ] Reuse the parity harness from `wi-60406`.
- [ ] Locate status model loading, runtime readiness, and recovery diagnostic
      paths.
- [ ] Add graph-derived formal relationship facts to status output where useful.
- [ ] Add projection diagnostics without changing runtime readiness decisions.
- [ ] Prove informational edges do not affect operational status, recovery, or
      claimability.
- [ ] Preserve JSON schema version and existing output fields unless an
      intentional addition is documented and tested.
- [ ] Add read-only safety coverage for status execution.

## Deliverables

- Graph-informed Work status output.
- Tests preserving runtime and git authority.
- Tests proving informational edges are diagnostic-only for status.

## Acceptance Criteria

- [ ] Status output can include graph-derived formal relationship facts.
- [ ] Projection diagnostics are visible in a deterministic location if added.
- [ ] Runtime readiness remains sourced from runtime sqlite and execution logs.
- [ ] Git worktree and recovery diagnostics remain sourced from git/runtime
      state.
- [ ] Informational edges do not affect readiness, recovery, claimability, or
      lifecycle interpretation.
- [ ] Existing status output remains stable except for documented, test-covered
      additions.
- [ ] No mutation or runtime claim behavior is introduced.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `doc-vader backlog validate --dir backlog --fail-on error`.

## Blocked by

- [[60406-immutable-work-command-inventory-and-parity-harness]]
- [[60398-graph-informed-work-ready-migration]]

## Relationships

- `depends_on`: `[[60406-immutable-work-command-inventory-and-parity-harness]]`
- `depends_on`: `[[60398-graph-informed-work-ready-migration]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-immutable-command-graph-migration-prd.md]]`
