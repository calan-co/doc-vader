---
id: wi-60386
title: Projection Port Tracer
summary: Add a minimal graph-aligned projection port for Work Items, Claims, Records, and Scopes.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: high
estimated: 4
links:
  depends_on:
    - '[[60384-work-command-surface-and-scoperef-canonicalization]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
tags:
  - afk
  - projection
  - graph
  - architecture
---

## Goal

Create the first graph-aligned projection port so Doc-Vader can expose a stable
overlay graph without forcing commands to execute through the graph.

## Background

The MVP distinction is projection versus command. The graph should make current
entities and relationships queryable, while commands remain adjacent to the
graph and are informed by projected facts. GraphQL may become a read-oriented
interface later, but this slice should keep the implementation minimal and
package-neutral.

The minimal node vocabulary for this slice is WorkItem, Claim, Record, and
Scope. Code is reserved as a future scope target and should not be modeled as a
first-class node unless an implementation requirement emerges.

## What to build

Add a thin internal projection port that can project repository-backed entities
into a graph-shaped read model and query basic node/edge facts. The port should
be compatible with a later `context-graph` dependency, but it must not couple
the repo to a sibling checkout path.

## Tasks

- [ ] Define the minimal projection port interfaces for nodes, edges, stable
      identifiers, and query access.
- [ ] Register node types for WorkItem, Claim, Record, and Scope.
- [ ] Reserve Code as a future scope target without implementing Code node
      projection.
- [ ] Project Work Item nodes using canonical Work Item identifiers and ScopeRef
      vocabulary from `60384`.
- [ ] Add minimal Claim, Record, and Scope node projection stubs backed by
      existing repository/runtime data where available.
- [ ] Add tests proving deterministic node projection and query access.
- [ ] Document that commands remain adjacent to, not funneled through, the graph
      for this MVP.

## Deliverables

- Internal projection port interfaces.
- Minimal graph node projection for WorkItem, Claim, Record, and Scope.
- Query helper for projected node and edge facts.
- Tests for deterministic projection.

## Acceptance Criteria

- [ ] The port can project WorkItem, Claim, Record, and Scope nodes.
- [ ] Projected node identifiers are stable and storage-independent.
- [ ] The implementation does not require GraphQL or a direct `context-graph`
      package dependency.
- [ ] The implementation does not import from a sibling workspace path.
- [ ] Commands are not required to execute through the projection graph.
- [ ] Tests prove repeated projection over the same source data yields stable
      node facts.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60384-work-command-surface-and-scoperef-canonicalization]]

## Relationships

- `depends_on`: `[[60384-work-command-surface-and-scoperef-canonicalization]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]`
