---
id: wi-60406
title: Immutable Work Command Inventory And Parity Harness
summary: Freeze the Work command tree as immutable inventory data and verify CLI help parity across the canonical and compatibility aliases.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 1
completed_date: '2026-06-29'
links:
  depends_on:
    - '[[60384-work-command-surface-and-scoperef-canonicalization]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]'
tags:
  - afk
  - work-management
  - command-surface
  - testing
---

## Goal

Freeze the Work command tree and alias contract in one immutable inventory and
prove that `dv work`, `dv wi`, and `dv task` stay help-compatible across that
surface.

## Background

- `dv work`, `dv wi`, and `dv task` intentionally expose the same family-level
  surface, so command additions need one explicit source of truth instead of
  relying on scattered help text checks.
- The initial `60406` implementation landed on this branch, but the local work
  item was missing, so completion evidence could not be recorded.
- Full-suite validation still carries an unrelated
  `tests/task-command.test.ts` schema-resolution failure that reproduces on the
  pre-issue commit `79d18887ced8070dd6d4b1914501dc1825fe1be9`.

## Tasks

- [x] Add an explicit immutable Work command inventory and alias list under
      `lib/work/**`.
- [x] Export the inventory helpers from `lib/work/index.ts` for reuse.
- [x] Add a parity harness that compares `work`, `wi`, and `task` help output
      against the inventory.
- [x] Remove duplicate CLI help invocations so the parity harness stays stable
      inside the full Vitest suite.
- [x] Run validation for this slice and isolate the remaining unrelated
      `tests/task-command.test.ts` failures to pre-issue commit
      `79d18887ced8070dd6d4b1914501dc1825fe1be9`.

## Deliverables

- Immutable Work command inventory and alias exports.
- CLI help parity coverage for the inventoried Work tree.
- Validation evidence showing the remaining task-command failures are outside
  `60406`.

## Acceptance Criteria

- [x] The canonical Work command tree is declared once as immutable data and
      includes the current graph and top-level subcommands.
- [x] Alias help for `work`, `wi`, and `task` matches the canonical Work help
      for every inventoried node.
- [x] `tests/work-command-parity.test.ts` passes when run directly and no
      longer fails in the full suite.
- [x] `pnpm run typecheck` passes on `sandcastle/issue-60406`.
- [x] `pnpm run test` was executed, and the only remaining failures are the
      pre-existing `tests/task-command.test.ts` schema-resolution assertions
      reproduced on `79d18887ced8070dd6d4b1914501dc1825fe1be9`.

## Relationships

- `depends_on`: `[[60384-work-command-surface-and-scoperef-canonicalization]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]`
