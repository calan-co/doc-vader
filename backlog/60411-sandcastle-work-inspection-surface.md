---
id: wi-60411
title: Sandcastle Work Inspection Surface
summary: Deliver dv4sandcastle view and prompt over canonical dv work inspection without ad hoc Markdown parsing.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 5
completed_date: '2026-06-30'
links:
  depends_on:
    - '[[60410-sandcastle-planning-list-surface]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-sandcastle-ready-work-cli-prd.md]]'
  evidence:
    - '[[task-record-preflight|2026-06-30: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.]]'
    - '[[record-20260701-054535-60411]]'
tags:
  - afk
  - sandcastle
  - command-surface
  - work-management
---

## Goal

Make Sandcastle inspection use `dv4sandcastle view` and `dv4sandcastle prompt`
as thin adapters over canonical `dv work` inspection output.

## Notes

- 2026-06-30: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.

## Background

After planning selects a work item, Sandcastle needs stable context for the
implementation agent. That context must come from the same Work model used by
selection, including graph relationships, ScopeRef semantics, and canonical
prompt rendering. It must not reintroduce a separate Markdown parser.

## What to build

Provide Sandcastle-facing view and prompt commands that expose canonical work
item context and execution prompt text through the adapter surface. The commands
should preserve the distinction between work inspection, implementation prompt
rendering, and mutation authority.

## Tasks

- [x] Add or update `dv4sandcastle view` for canonical work item inspection.
- [x] Add or update `dv4sandcastle prompt` for implementation-agent prompt
      rendering.
- [x] Back inspection with `dv work show` and prompt rendering with
      `dv work prompt`.
- [x] Remove reliance on ad hoc Markdown parsing for Sandcastle inspection.
- [x] Preserve graph relationship and ScopeRef context visible to agents.
- [x] Keep inspection commands read-only.
- [x] Add CLI or integration coverage for view and prompt output.

## Deliverables

- Sandcastle-compatible `dv4sandcastle view` behavior.
- Sandcastle-compatible `dv4sandcastle prompt` behavior.
- Tests proving inspection uses canonical Work context and does not mutate
  state.

## Acceptance Criteria

- [x] `dv4sandcastle view` returns canonical work context for a selected item.
- [x] `dv4sandcastle prompt` returns implementation-ready prompt content for a
      selected item.
- [x] Both commands are backed by `dv work` inspection surfaces.
- [x] No separate Markdown-only parser is required for Sandcastle inspection.
- [x] Inspection output includes relevant dependency, relationship, and scope
      context.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `doc-vader backlog validate --dir backlog --fail-on error`.

## Blocked by

- [[60410-sandcastle-planning-list-surface]]

## Relationships

- `depends_on`: `[[60410-sandcastle-planning-list-surface]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-sandcastle-ready-work-cli-prd.md]]`
