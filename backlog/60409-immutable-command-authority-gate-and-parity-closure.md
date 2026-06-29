---
id: wi-60409
title: Immutable Command Authority Gate and Parity Closure
summary: Close the immutable command migration lane with formal-only authority checks and parity evidence.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: high
estimated: 4
links:
  depends_on:
    - "[[60407-graph-backed-work-prompt-relationship-context]]"
    - "[[60408-graph-informed-work-status-read-model]]"
  reference:
    - "[[../docs/how-to/implementation-plans/doc-vader-immutable-command-graph-migration-prd.md]]"
tags:
  - afk
  - cli
  - graph
  - work-management
---

## Goal

Close the immutable Work command migration lane by enforcing formal-only
authority checks, preserving informational diagnostics, and recording parity
evidence for the migrated read-only command surfaces.

## Background

After prompt and status migration, the repo needs a final cross-command pass to
prove the graph read model has not leaked into mutation authority. This slice
also gives future agents a durable boundary for any later graph-informed
mutation PRD.

This work must not migrate mutation commands.

## What to build

Add cross-command tests and documentation updates showing that formal edges are
the only graph facts eligible for governance-sensitive command interpretation.
Confirm informational edges and unresolved observations remain diagnostics or
review metadata across list, show, ready, prompt, status, and graph explorer
surfaces.

## Tasks

- [ ] Review completed immutable command migration work against the PRD.
- [ ] Add cross-command tests for formal-only governance behavior.
- [ ] Add cross-command tests for informational diagnostic visibility.
- [ ] Prove mutation commands still use canonical document/runtime write
      models.
- [ ] Record parity evidence for list, show, ready, prompt, and status.
- [ ] Update maintainer-facing notes or implementation-plan references if the
      command inventory changed during implementation.
- [ ] Run documentation and backlog validation gates.

## Deliverables

- Cross-command authority gate tests.
- Immutable command migration parity evidence.
- Updated command inventory or notes, if implementation changed the initial
  classification.

## Acceptance Criteria

- [ ] Formal edges are the only projected graph facts that can influence
      governance-sensitive command interpretation.
- [ ] Informational edges are visible only as diagnostics, metadata, or review
      facts.
- [ ] Mutation and mutation-adjacent commands continue to use document/runtime
      write models.
- [ ] List, show, ready, prompt, and status parity evidence is recorded in tests
      or documentation.
- [ ] No claim, recover, record, lock mutation, archive, finalize, or lifecycle
      transition behavior is changed.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `doc-vader backlog validate --dir backlog --fail-on error`.
- [ ] Validation passes with `pnpm run backlog:validate:ci`.

## Blocked by

- [[60407-graph-backed-work-prompt-relationship-context]]
- [[60408-graph-informed-work-status-read-model]]

## Relationships

- `depends_on`: `[[60407-graph-backed-work-prompt-relationship-context]]`
- `depends_on`: `[[60408-graph-informed-work-status-read-model]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-immutable-command-graph-migration-prd.md]]`
