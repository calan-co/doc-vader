---
id: wi-60390
title: Record Edges And Audit Lineage
summary: Project record relationships into graph edges and expose claim, scope, and work lineage in audit output.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: high
estimated: 4
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

## What to build

Extend graph projection so records project to Record nodes and `records` edges
target WorkItem, Claim, or Scope nodes. Extend audit output to include the
projected lineage for scope-gated command records and Work Item evidence.

## Tasks

- [ ] Define the `records` edge type and record-kind attributes.
- [ ] Project Record nodes from existing backlog/runtime records.
- [ ] Project `Record --records--> WorkItem` edges for Work Item evidence where
      references are available.
- [ ] Project `Record --records--> Claim` and `Record --records--> Scope` edges
      for claim-scope command records where references are available.
- [ ] Extend audit output with deterministic record lineage.
- [ ] Add tests for record edge projection and audit ordering.

## Deliverables

- Record node projection.
- `records` edge projection for WorkItem, Claim, and Scope targets.
- Audit output with deterministic lineage sections.
- Tests for record projection and audit ordering.

## Acceptance Criteria

- [ ] Records project as graph nodes with stable identifiers.
- [ ] Record relationships project as `Record --records--> target` edges.
- [ ] Record edges include record-kind attributes.
- [ ] Audit output can show claim, scope, and Work Item lineage for projected
      records.
- [ ] Projection remains deterministic across repeated runs.
- [ ] Tests cover WorkItem, Claim, and Scope record targets.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60387-claim-lock-graph-projection]]
- [[60389-post-mutation-graph-verification]]

## Relationships

- `depends_on`: `[[60387-claim-lock-graph-projection]]`
- `depends_on`: `[[60389-post-mutation-graph-verification]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]`
