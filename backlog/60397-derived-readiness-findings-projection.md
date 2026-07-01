---
id: wi-60397
title: Derived Readiness Findings Projection
summary: Represent dependency, resource, policy, and evidence blockers as derived readiness findings instead of canonical relationship edges.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 5
completed_date: '2026-06-26'
links:
  depends_on:
    - '[[60393-read-only-work-graph-explorer-cli]]'
    - '[[60380-deterministic-backlog-review-profile]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
  evidence:
    - '[[record-20260701-032943-60397]]'
tags:
  - afk
  - governance
  - graph
  - readiness
  - work-management
---

## Goal

Create a derived readiness findings model so transient blockers can be reviewed
and consumed by selection logic without becoming durable authored relationship
edges.

## Background

The graph relationship vocabulary intentionally excludes canonical `blocks` and
generic `relates_to` edges. A Work Item may be unready because a dependency is
unfinished, a scope is locked, evidence is missing, or a policy gate fails, but
those are operational findings derived from current facts rather than durable
relationships authored by the Work Item.

`depends_on` remains the durable relationship edge for natural dependencies.
Blocker state is derived from relationships, runtime/resource state, and policy.

## What to build

Add a derived readiness findings projection that can evaluate graph
relationships plus relevant runtime or governance facts and emit stable finding
records with reason codes, subject identifiers, severity, and supporting
evidence. Do not add `blocks` or `relates_to` as canonical relationship edges.

## Tasks

- [x] Define the derived readiness finding shape and stable reason-code
      vocabulary.
- [x] Emit findings for unsatisfied `depends_on` relationships.
- [x] Emit findings for resource or scope conflicts when available from current
      runtime data.
- [x] Emit findings for missing evidence or policy blockers already represented
      by governance checks.
- [x] Keep findings separate from graph relationship edges in data structures
      and output.
- [x] Add tests proving blocker state is derived without emitting `blocks`.
- [x] Add tests proving generic `relates_to` is not needed for MVP readiness.
- [x] Document the boundary between authored relationships and derived
      readiness findings.

## Deliverables

- Derived readiness finding model and reason-code set.
- Projection or evaluation helper that emits findings from graph and governance
      inputs.
- Tests covering dependency, resource, policy, and evidence finding categories.

## Acceptance Criteria

- [x] Findings include stable reason codes and subject identifiers.
- [x] An unfinished `depends_on` target creates a derived finding, not a
      `blocks` edge.
- [x] Resource and scope conflicts create derived findings when current data is
      available.
- [x] Missing evidence or policy blockers create derived findings through the
      governance path.
- [x] Findings remain separate from canonical graph edges in JSON structures.
- [x] No canonical `blocks` or `relates_to` edge is emitted.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60393-read-only-work-graph-explorer-cli]]
- [[60380-deterministic-backlog-review-profile]]

## Relationships

- `depends_on`: `[[60393-read-only-work-graph-explorer-cli]]`
- `depends_on`: `[[60380-deterministic-backlog-review-profile]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]`
