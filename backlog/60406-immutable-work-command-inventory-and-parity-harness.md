---
id: wi-60406
title: Immutable Work Command Inventory and Parity Harness
summary: Classify remaining read-only Work command surfaces and add a parity harness for graph-backed migration.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: high
estimated: 4
links:
  reference:
    - "[[../docs/how-to/implementation-plans/doc-vader-immutable-command-graph-migration-prd.md]]"
    - "[[60395-graph-backed-work-list-tracer]]"
    - "[[60396-graph-backed-work-show-relationships]]"
    - "[[60398-graph-informed-work-ready-migration]]"
tags:
  - afk
  - cli
  - graph
  - work-management
---

## Goal

Create the command inventory and test harness needed to migrate remaining
immutable Work command surfaces to graph-backed or graph-informed read models
without changing mutation behavior.

## Background

List, show relationship sections, derived readiness findings, and ready
selection have already moved through graph-backed or graph-informed slices. The
next migration needs a shared definition of which commands are immutable, which
are mutation-adjacent, and how command output parity is proven before changing
defaults.

This work must not migrate command behavior by itself.

## What to build

Add a maintainer-facing inventory and a reusable parity test pattern for Work
command migration. The inventory should classify commands as graph-backed,
graph-informed, deferred, mutation/write-model, or out of scope, with a short
reason for each classification.

## Tasks

- [ ] Locate current `task`, `work`, and `wi` command surfaces.
- [ ] Classify each Work command by read/write behavior and graph migration
      posture.
- [ ] Capture completed graph-backed list, show, and ready behavior as prior
      art.
- [ ] Add or refactor a parity harness that compares command outputs across
      aliases and graph-backed read expectations.
- [ ] Add read-only safety assertions where the harness runs immutable commands.
- [ ] Document the mutation boundary for claim, recover, record, lock mutation,
      archive, finalize, and lifecycle transition commands.

## Deliverables

- Immutable Work command inventory.
- Reusable parity test helper or fixture pattern.
- Tests proving immutable command execution does not mutate runtime or document
  state in the covered harness.

## Acceptance Criteria

- [ ] Every current `task`, `work`, and `wi` command is classified.
- [ ] Remaining graph migration candidates are identified without re-opening
      completed list, show relationship, or ready slices.
- [ ] Mutation and mutation-adjacent commands are explicitly excluded from this
      PRD's read-model migration.
- [ ] The parity harness can be reused by prompt and status migration slices.
- [ ] The harness verifies stable command output or documents intentional
      differences.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `doc-vader backlog validate --dir backlog --fail-on error`.

## Relationships

- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-immutable-command-graph-migration-prd.md]]`
- `references`: `[[60395-graph-backed-work-list-tracer]]`
- `references`: `[[60396-graph-backed-work-show-relationships]]`
- `references`: `[[60398-graph-informed-work-ready-migration]]`
