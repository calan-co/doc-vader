---
id: wi-60389
title: Post-Mutation Graph Verification
summary: Verify graph facts after scope-gated command mutations and fail closed on projection mismatch.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: high
estimated: 5
links:
  depends_on:
    - '[[60387-claim-lock-graph-projection]]'
    - '[[60388-scope-gated-renewal]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
tags:
  - afk
  - mutation
  - projection
  - verification
---

## Goal

Add the first command lifecycle that projects, gates, mutates, reprojects, and
verifies graph facts before reporting success.

## Background

Commands should be adjacent to the graph and informed by it, rather than
funneled through projection as the mutation engine. The useful lifecycle is:
project current facts, gate the command, mutate the authoritative store,
reproject, verify the expected graph facts, and only then record success.

This slice creates the verification pattern for scope-gated mutations after the
claim scope and lock graph foundation is available.

## What to build

Wrap at least one representative scope-gated command mutation in a post-mutation
graph verification flow. The command should fail closed if the expected
WorkItem, Claim, Scope, or `locks` edge facts do not appear after mutation.

## Tasks

- [ ] Choose the lowest-risk representative scope-gated mutation command.
- [ ] Project current graph facts before command gating.
- [ ] Gate the command using the authoritative claim-scope policy path.
- [ ] Mutate the authoritative store through existing command infrastructure.
- [ ] Reproject after mutation.
- [ ] Verify expected graph facts and edge attributes after mutation.
- [ ] Fail closed with deterministic diagnostics if verification fails.
- [ ] Add tests for successful verification and projection mismatch failure.

## Deliverables

- Post-mutation graph verification helper or command wrapper.
- One representative command integrated with the verification lifecycle.
- Tests for success and fail-closed mismatch behavior.

## Acceptance Criteria

- [ ] A scope-gated command performs project, gate, mutate, reproject, and verify
      steps.
- [ ] The command does not rely on projection as the source of write authority.
- [ ] The command fails closed when expected graph facts are missing or stale.
- [ ] Verification diagnostics identify the missing node or edge facts.
- [ ] Tests prove both success and mismatch failure behavior.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60387-claim-lock-graph-projection]]
- [[60388-scope-gated-renewal]]

## Relationships

- `depends_on`: `[[60387-claim-lock-graph-projection]]`
- `depends_on`: `[[60388-scope-gated-renewal]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]`
