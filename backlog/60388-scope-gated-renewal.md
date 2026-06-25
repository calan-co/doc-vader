---
id: wi-60388
title: Scope-Gated Renewal
summary: Renew immutable claims only when their associated scopes remain available under current lock policy.
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
    - '[[60385-flat-claim-scopes-and-lock-policies]]'
    - '[[60387-claim-lock-graph-projection]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
tags:
  - afk
  - claims
  - renewal
  - scopes
---

## Goal

Implement claim renewal without changing claim identity and without introducing
a release-and-relock gap across associated scopes.

## Background

Claim identity is immutable. A claim can only be renewed if its associated
scopes are available under the current scope-lock policy. Renewal must
revalidate every associated scope atomically so an agent cannot accidentally
extend authority over a scope that has become unavailable.

## What to build

Update claim renewal so it evaluates all associated ScopeRefs through the flat
claim-scope policy path from `60385`, using projected lock facts from `60387`
where helpful for verification and diagnostics. Renewal should extend the
existing claim's validity window or lease metadata only when all relevant scope
locks remain compatible.

## Tasks

- [x] Locate current claim renewal or lease-extension behavior.
- [x] Model renewal as an operation on immutable claim identity.
- [x] Revalidate every associated ScopeRef before extending the claim.
- [x] Ensure the renewal check and metadata update are atomic for the backing
      runtime store.
- [x] Prevent release-and-reacquire gaps during renewal.
- [x] Return deterministic errors when any associated scope is unavailable.
- [x] Add tests for successful renewal, blocked renewal, and mixed-scope
      failure.

## Deliverables

- Scope-gated claim renewal implementation.
- Atomic renewal behavior for all associated claim scopes.
- Tests for renewal success and conflict failure.

## Acceptance Criteria

- [x] Renewal preserves the existing claim identity.
- [x] Renewal succeeds only when every associated scope remains available.
- [x] Renewal fails without releasing existing locks when any associated scope
      is unavailable.
- [x] Renewal produces deterministic diagnostics naming the conflicting
      ScopeRef and lock mode.
- [x] Tests cover read, write, and execute scope renewal cases.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60385-flat-claim-scopes-and-lock-policies]]
- [[60387-claim-lock-graph-projection]]

## Relationships

- `depends_on`: `[[60385-flat-claim-scopes-and-lock-policies]]`
- `depends_on`: `[[60387-claim-lock-graph-projection]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]`
