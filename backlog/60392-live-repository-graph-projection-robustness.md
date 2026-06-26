---
id: wi-60392
title: Live Repository Graph Projection Robustness
summary: Make live repository Work graph projection skip or classify non-projectable documents deterministically.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: high
estimated: 3
links:
  depends_on:
    - '[[60386-projection-port-tracer]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
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

- [ ] Find the live repository projection path used by Work graph queries.
- [ ] Add a deterministic non-projectable document classification result.
- [ ] Include diagnostic fields for path, document id when available, and
      reason code.
- [ ] Ensure valid WorkItem, Claim, Record, and Scope facts still project.
- [ ] Ensure helper documents such as `backlog/AGENTS.md` do not crash
      projection.
- [ ] Add focused tests for non-projectable documents and live repository
      projection behavior.
- [ ] Document any intentionally skipped document classes in code comments or
      test names.

## Deliverables

- Robust live repository graph projection behavior.
- Deterministic diagnostics for skipped or unsupported documents.
- Tests covering helper or policy documents that are not MVP graph entities.

## Acceptance Criteria

- [ ] A live projection over `backlog` and `docs` succeeds when
      `backlog/AGENTS.md` is present.
- [ ] Non-projectable documents are reported with stable path, id when known,
      and reason code.
- [ ] Projectable WorkItem, Claim, Record, and Scope nodes and edges are still
      emitted with existing provenance.
- [ ] Projection remains read-only and does not write runtime or repository
      artifacts.
- [ ] Tests cover at least one valid generic document whose id is not a
      canonical ScopeRef.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60386-projection-port-tracer]]

## Relationships

- `depends_on`: `[[60386-projection-port-tracer]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]`
