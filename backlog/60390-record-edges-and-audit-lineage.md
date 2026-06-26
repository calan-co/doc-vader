---
id: wi-60390
title: Record Edges And Audit Lineage
summary: Project record relationships into graph edges and expose claim, scope, and work lineage in audit output.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 4
completed_date: '2026-06-26'
links:
  depends_on:
    - '[[60387-claim-lock-graph-projection]]'
    - '[[60389-post-mutation-graph-verification]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
tags:
  - afk
  - records
  - audit
  - projection
---

## Goal

Make records first-class graph participants so audit output can explain how
evidence, notes, and command results relate to Work Items, Claims, and Scopes.

## Background

The MVP node list includes Record alongside WorkItem, Claim, and Scope. Records
should not be passive Markdown or JSON blobs; they provide lineage for policy
enforcement, command verification, evidence, and recovery.

The initial edge shape is `Record --records--> WorkItem|Claim|Scope`, with edge
attributes specifying the record kind such as evidence, note, audit note, or
test result.

This edge follows the authored edge direction rule from the PRD: the Record is
the assertion owner, and the recorded entity is the subject of that audit or
evidence fact.

## What to build

Extend graph projection so records project to Record nodes and `records` edges
target WorkItem, Claim, or Scope nodes. Extend audit output to include the
projected lineage for scope-gated command records and Work Item evidence.

## Tasks

- [x] Define the `records` edge type and record-kind attributes.
- [x] Ensure `records` follows the canonical authored direction:
      `Record --records--> WorkItem|Claim|Scope`.
- [x] Project Record nodes from existing backlog/runtime records.
- [x] Project `Record --records--> WorkItem` edges for Work Item evidence where
      references are available.
- [x] Project `Record --records--> Claim` and `Record --records--> Scope` edges
      for claim-scope command records where references are available.
- [x] Extend audit output with deterministic record lineage.
- [x] Add tests for record edge projection and audit ordering.

## Deliverables

- Record node projection.
- `records` edge projection for WorkItem, Claim, and Scope targets.
- Audit output with deterministic lineage sections.
- Tests for record projection and audit ordering.

## Acceptance Criteria

- [x] Records project as graph nodes with stable identifiers.
- [x] Record relationships project as `Record --records--> target` edges.
- [x] `records` edges follow the assertion-owner-to-target direction.
- [x] Record edges include record-kind attributes.
- [x] Audit output can show claim, scope, and Work Item lineage for projected
      records.
- [x] Projection remains deterministic across repeated runs.
- [x] Tests cover WorkItem, Claim, and Scope record targets.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60387-claim-lock-graph-projection]]
- [[60389-post-mutation-graph-verification]]

## Relationships

- `depends_on`: `[[60387-claim-lock-graph-projection]]`
- `depends_on`: `[[60389-post-mutation-graph-verification]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]`
