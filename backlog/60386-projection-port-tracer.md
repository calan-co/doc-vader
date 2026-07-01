---
id: wi-60386
title: Projection Port Tracer
summary: Add a minimal graph-aligned projection port for Work Items, Claims, Records, Scopes, and authored relationship edges.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 4
completed_date: '2026-06-25'
links:
  depends_on:
    - '[[60384-work-command-surface-and-scoperef-canonicalization]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
  evidence:
    - '[[record-20260701-032943-60386]]'
tags:
  - afk
  - projection
  - graph
  - architecture
---

## Goal

Create the first graph-aligned projection port so Doc-Vader can expose a stable
overlay graph without forcing commands to execute through the graph.

## Notes

- 2026-06-30: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.

## Background

The MVP distinction is projection versus command. The graph should make current
entities and relationships queryable, while commands remain adjacent to the
graph and are informed by projected facts. GraphQL may become a read-oriented
interface later, but this slice should keep the implementation minimal and
package-neutral.

The minimal node vocabulary for this slice is WorkItem, Claim, Record, and
Scope. Code is reserved as a future scope target and should not be modeled as a
first-class node unless an implementation requirement emerges.

Canonical authored edge direction follows assertion ownership: the entity
making the assertion points to the target it depends on, belongs to, implements,
locks, or records. Reverse traversal is a query/view concern, not a second
authored edge. Transient blocker state is a derived operational finding, not a
canonical `blocks` relationship.

## What to build

Add a thin internal projection port that can project repository-backed entities
into a graph-shaped read model and query basic node/edge facts. The port should
be compatible with a later `context-graph` dependency, but it must not couple
the repo to a sibling checkout path. The first projection must include the
WorkItem relationship edges needed for selection and governance:
`depends_on`, `belongs_to`, and `implements`.

## Tasks

- [x] Define the minimal projection port interfaces for nodes, edges, stable
      identifiers, and query access.
- [x] Encode the authored edge direction rule: assertion owner points to target,
      and reverse traversal is derived query behavior.
- [x] Register node types for WorkItem, Claim, Record, and Scope.
- [x] Reserve Code as a future scope target without implementing Code node
      projection.
- [x] Project Work Item nodes using canonical Work Item identifiers and ScopeRef
      vocabulary from `60384`.
- [x] Project `WorkItem --depends_on--> WorkItem` edges from declared Work Item
      dependency metadata.
- [x] Project `WorkItem --belongs_to--> WorkItem|Milestone|Project` edges when
      planning or governance parent metadata is declared.
- [x] Project `WorkItem --implements--> PRD|ADR|Requirement|Decision` edges when
      traceability metadata is declared.
- [x] Add minimal Claim, Record, and Scope node projection stubs backed by
      existing repository/runtime data where available.
- [x] Exclude `blocks` and generic `relates_to` from the canonical authored edge
      set; expose blockers as derived operational findings if needed.
- [x] Add tests proving deterministic node projection and query access.
- [x] Document that commands remain adjacent to, not funneled through, the graph
      for this MVP.

## Deliverables

- Internal projection port interfaces.
- Minimal graph node projection for WorkItem, Claim, Record, and Scope.
- WorkItem `depends_on`, `belongs_to`, and `implements` edge projection.
- Query helper for projected node and edge facts.
- Tests for deterministic projection.

## Acceptance Criteria

- [x] The port can project WorkItem, Claim, Record, and Scope nodes.
- [x] Authored edge direction follows assertion ownership across projected
      relationship edges.
- [x] WorkItem `depends_on`, `belongs_to`, and `implements` edges project
      deterministically when declared.
- [x] `blocks` is not emitted as a canonical authored relationship edge.
- [x] Projected node identifiers are stable and storage-independent.
- [x] The implementation does not require GraphQL or a direct `context-graph`
      package dependency.
- [x] The implementation does not import from a sibling workspace path.
- [x] Commands are not required to execute through the projection graph.
- [x] Tests prove repeated projection over the same source data yields stable
      node facts.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60384-work-command-surface-and-scoperef-canonicalization]]

## Relationships

- `depends_on`: `[[60384-work-command-surface-and-scoperef-canonicalization]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]`
