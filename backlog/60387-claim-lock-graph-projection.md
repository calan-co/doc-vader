---
id: wi-60387
title: Claim Lock Graph Projection
summary: Project claim scope locks into graph edges with mode and policy attributes.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: high
estimated: 4
links:
  depends_on:
    - '[[60385-flat-claim-scopes-and-lock-policies]]'
    - '[[60386-projection-port-tracer]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
tags:
  - afk
  - projection
  - claims
  - locks
---

## Goal

Make active claim scope locks visible in the projection graph as explicit
relationships between claims and scopes.

## Background

The graph model should expose relationship and interaction across entities, not
just standalone documents. Claim locks are the first useful edge type because
they connect command authority to stable target scopes and make current
privilege state inspectable.

For the MVP, the edge shape is `Claim --locks--> Scope` with attributes for lock
mode and policy. Enforcement remains in the command path introduced by
`60385`; this slice projects the facts needed for audit, verification, and
later query surfaces.

## What to build

Extend the projection port from `60386` so flat claim scopes from `60385`
project into `locks` edges from Claim nodes to Scope nodes. Include lock mode,
policy name, claim identity, ScopeRef, acquisition metadata, and current status
as edge attributes where available.

## Tasks

- [ ] Define the `locks` edge type in the projection vocabulary.
- [ ] Project one edge for each active claim-scope lock.
- [ ] Attach lock mode and policy attributes to each edge.
- [ ] Ensure Claim and Scope nodes referenced by lock edges are projected or
      resolvable.
- [ ] Keep command enforcement in the claim-scope policy path rather than moving
      enforcement into graph projection.
- [ ] Add query tests for Claim-to-Scope lock edge projection.
- [ ] Add fixture coverage for read, write, and execute lock modes.

## Deliverables

- `locks` edge projection.
- Edge attributes for lock mode, policy, claim identity, ScopeRef, and status.
- Tests proving lock edge projection from flat claim-scope data.

## Acceptance Criteria

- [ ] Active claim scopes project as `Claim --locks--> Scope` edges.
- [ ] Each lock edge includes the lock mode.
- [ ] Each lock edge includes enough policy metadata to explain compatibility
      decisions.
- [ ] Projection does not mutate claim, lock, or Work Item state.
- [ ] Missing node references fail closed or surface deterministic projection
      findings.
- [ ] Tests prove deterministic edge output for read, write, and execute locks.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60385-flat-claim-scopes-and-lock-policies]]
- [[60386-projection-port-tracer]]

## Relationships

- `depends_on`: `[[60385-flat-claim-scopes-and-lock-policies]]`
- `depends_on`: `[[60386-projection-port-tracer]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]`
