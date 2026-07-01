---
id: wi-60392
title: Live Repository Graph Projection Robustness
summary: Make live repository Work graph projection skip or classify non-projectable documents deterministically.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 3
completed_date: '2026-06-26'
commits:
  45c355eed796dd174f97fc52ef97225842da25f6: 'feat(work): merge sandcastle work graph updates'
links:
  depends_on:
    - '[[60386-projection-port-tracer]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
  evidence:
    - '[[record-20260701-032943-60392]]'
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/74
tags:
  - afk
  - projection
  - graph
  - work-management
---

## Goal

Make the live repository Work graph projectable even when the scan includes
helper, policy, or generic documents that are valid repository artifacts but are
not graph nodes for the Work Item + Claim + Scope MVP.

## Background

The read-only graph explorer needs to inspect the actual repository, not only
curated fixtures. The repository contains documents such as `backlog/AGENTS.md`
whose frontmatter is valid but whose identifiers are not canonical ScopeRefs or
MVP graph entities. Those documents should not make graph inspection fail.

This work keeps projection deterministic without expanding the MVP graph model.
Non-projectable documents are diagnostics, not projected nodes.

## What to build

Update repository graph projection so whole-repository scans over `backlog` and
`docs` classify each parsed document as projectable, skipped, or unsupported.
Unsupported documents must produce deterministic diagnostics with enough detail
for a maintainer to understand why they were not projected.

Do not mutate repository files, runtime claims, locks, records, or audit
artifacts as part of projection.

## Tasks

- [x] Find the live repository projection path used by Work graph queries.
- [x] Add a deterministic non-projectable document classification result.
- [x] Include diagnostic fields for path, document id when available, and
      reason code.
- [x] Ensure valid WorkItem, Claim, Record, and Scope facts still project.
- [x] Ensure helper documents such as `backlog/AGENTS.md` do not crash
      projection.
- [x] Add focused tests for non-projectable documents and live repository
      projection behavior.
- [x] Document any intentionally skipped document classes in code comments or
      test names.

## Deliverables

- Robust live repository graph projection behavior.
- Deterministic diagnostics for skipped or unsupported documents.
- Tests covering helper or policy documents that are not MVP graph entities.

## Acceptance Criteria

- [x] A live projection over `backlog` and `docs` succeeds when
      `backlog/AGENTS.md` is present.
- [x] Non-projectable documents are reported with stable path, id when known,
      and reason code.
- [x] Projectable WorkItem, Claim, Record, and Scope nodes and edges are still
      emitted with existing provenance.
- [x] Projection remains read-only and does not write runtime or repository
      artifacts.
- [x] Tests cover at least one valid generic document whose id is not a
      canonical ScopeRef.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60386-projection-port-tracer]]

## Relationships

- `depends_on`: `[[60386-projection-port-tracer]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]`
