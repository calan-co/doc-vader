---
id: wi-60391
title: Projection Package Boundary Guard
summary: Document and test the context-graph and Semantify dependency posture with explicit pivot signals.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: medium
estimated: 3
links:
  depends_on:
    - '[[60386-projection-port-tracer]]'
    - '[[60390-record-edges-and-audit-lineage]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
tags:
  - afk
  - projection
  - packages
  - architecture
---

## Goal

Keep the projection and normalization architecture ready for separately
published packages without duplicating package behavior indefinitely.

## Background

`context-graph` and Semantify are intended to be standalone but composable
packages. The MVP should start with a thin internal projection port unless a
direct package dependency is lower-friction than maintaining local equivalents.
The important guardrail is to avoid recreating parallel implementations without
clear pivot signals.

Semantify is the most likely future dependency for Work normalization because it
may become the lightweight data catalog layer between repository artifacts and
governance rules.

## What to build

Document and test the package boundary after the projection, claim-lock, and
record-lineage slices exist. Add explicit pivot signals for when Doc-Vader
should replace local projection or normalization behavior with `context-graph`
or Semantify dependencies.

## Tasks

- [ ] Document the current internal projection port boundary and why it remains
      package-neutral.
- [ ] Document that sibling workspace imports are not allowed for this MVP.
- [ ] Define pivot signals for adopting `context-graph` as a direct dependency.
- [ ] Define pivot signals for adopting Semantify as a normalization/data
      catalog dependency.
- [ ] Add tests or static checks that protect against accidental sibling-path
      coupling.
- [ ] Identify any duplicated behavior introduced by prior projection slices and
      classify it as acceptable MVP glue or a dependency pivot candidate.

## Deliverables

- Architecture note or implementation-plan update describing package boundary
  posture.
- Explicit `context-graph` and Semantify pivot criteria.
- Import-boundary test or static check preventing sibling-path coupling.
- Duplication inventory with follow-up recommendations.

## Acceptance Criteria

- [ ] The docs define when to keep the internal projection port and when to
      pivot to `context-graph`.
- [ ] The docs define when Semantify should own normalization or data-catalog
      behavior.
- [ ] No production code imports from a sibling workspace path.
- [ ] A test or static check fails if direct sibling-path coupling is
      introduced.
- [ ] Any duplicated projection or normalization behavior is explicitly
      classified with a next action.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60386-projection-port-tracer]]
- [[60390-record-edges-and-audit-lineage]]

## Relationships

- `depends_on`: `[[60386-projection-port-tracer]]`
- `depends_on`: `[[60390-record-edges-and-audit-lineage]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]`
