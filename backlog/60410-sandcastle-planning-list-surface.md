---
id: wi-60410
title: Sandcastle Planning List Surface
summary: Deliver dv4sandcastle list as the Sandcastle planning entrypoint over authoritative dv work selection.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 6
completed_date: '2026-06-30'
links:
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-sandcastle-ready-work-cli-prd.md]]'
  evidence:
    - '[[task-record-preflight|2026-06-30: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.]]'
    - '[[record-20260701-054004-60410]]'
tags:
  - afk
  - sandcastle
  - command-surface
  - work-management
---

## Goal

Make Sandcastle planning enter Doc-Vader through `dv4sandcastle list`, backed by
authoritative `dv work` facts, deterministic AFK eligibility, and planner
horizon context.

## Notes

- 2026-06-30: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.

## Background

The compatibility window for the public `dv task` command surface has ended.
Sandcastle must no longer rely on ad hoc list scripts or legacy task aliases for
planning. The list surface is the first tracer bullet because it proves that
Sandcastle can discover safe work through `dv work` without bypassing runtime or
graph-derived eligibility facts.

## What to build

Provide a Sandcastle-ready planning list command that can serve as
`LIST_TASKS_COMMAND`. The command should return deterministic selectable work
plus non-selectable horizon context, use filter policy independently of output
format, and exclude unsafe work from the selectable set while preserving enough
context for planning quality.

## Tasks

- [x] Add or update the `dv4sandcastle list` command surface.
- [x] Back list selection with authoritative `dv work` filtering rather than
      Markdown-only parsing.
- [x] Return selectable candidates separately from horizon context.
- [x] Keep filter policy decoupled from rendering format.
- [x] Ensure blocked, HITL, claimed, halted, or otherwise unsafe work is not
      selectable.
- [x] Remove public reliance on the legacy `dv task` compatibility surface for
      this planning path.
- [x] Add CLI or integration coverage for the Sandcastle planning list
      contract.

## Deliverables

- Sandcastle-compatible `dv4sandcastle list` behavior.
- Selectable plus horizon planning payload.
- Tests proving list selection uses `dv work` authority and fail-closed
  eligibility.

## Acceptance Criteria

- [x] `dv4sandcastle list` can be used as Sandcastle's planning list command.
- [x] Selectable results are deterministic AFK-safe candidates.
- [x] Horizon context is present for planner reasoning but cannot be chosen as
      executable work.
- [x] Filtering policy is reusable with JSON output and not coupled to a single
      renderer.
- [x] Public `dv task` compatibility is removed or unavailable from this
      Sandcastle planning path.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `doc-vader backlog validate --dir backlog --fail-on error`.

## Blocked by

None - can start immediately.

## Relationships

- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-sandcastle-ready-work-cli-prd.md]]`
