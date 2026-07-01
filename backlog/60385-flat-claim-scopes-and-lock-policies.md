---
id: wi-60385
title: Flat Claim Scopes And Lock Policies
summary: Persist flat claim scopes and enforce atomic read, write, and execute lock compatibility rules.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 5
completed_date: '2026-06-25'
commits:
  45c355eed796dd174f97fc52ef97225842da25f6: 'feat(work): merge sandcastle work graph updates'
links:
  depends_on:
    - '[[60384-work-command-surface-and-scoperef-canonicalization]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
    - '[[60373-claim-command-surface]]'
    - '[[60374-lock-command-surface]]'
  evidence:
    - '[[record-20260701-032943-60385]]'
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/74
tags:
  - afk
  - claims
  - locks
  - scopes
---

## Goal

Introduce first-class flat claim scopes and lock policies so command execution
can reason over Work Item scopes instead of raw file locks.

## Background

Claims remain immutable identities. A claim may hold one or more scoped locks,
and each lock has a mode: read, write, or execute. Nested scopes and umbrella
claims are deferred for the MVP, but this slice should avoid choices that would
make nested scope introduction expensive later.

The initial compatibility matrix is intentionally small: reads can coexist with
reads, execute can coexist with read in either direction, and every other mode
combination is mutually exclusive. A read lock allows execution of that scope
but not writes to it.

## What to build

Add flat claim-scope persistence keyed by immutable claim identity, canonical
ScopeRef, and lock mode. Implement atomic `ReadLockPolicy`,
`WriteLockPolicy`, and `ExecuteLockPolicy` behavior over that data. Keep
existing file/resource locks behind storage or resource adapters rather than
making file paths the semantic lock target.

## Tasks

- [x] Define the flat claim-scope persistence shape for claim identity,
      ScopeRef, lock mode, acquisition metadata, and lifecycle metadata.
- [x] Wire claim creation and lock acquisition through canonical ScopeRefs from
      `60384`.
- [x] Implement read, write, and execute lock policies as separate policy units.
- [x] Enforce read/read coexistence.
- [x] Enforce read/execute and execute/read coexistence.
- [x] Enforce mutual exclusion for every other mode combination.
- [x] Keep file locks and other storage locks behind adapters.
- [x] Add focused tests for all compatibility matrix entries.

## Deliverables

- Flat claim-scope persistence.
- Atomic lock policy implementations.
- Adapter boundary preserving existing storage/resource lock behavior.
- Lock compatibility tests.

## Acceptance Criteria

- [x] Claim scopes are stored against immutable claim identity, ScopeRef, and
      lock mode.
- [x] Existing claim and lock commands can acquire scope locks through the new
      policy path.
- [x] Read locks can coexist with other read locks.
- [x] Execute locks can coexist with read locks in either acquisition order.
- [x] Write locks conflict with every existing read, write, or execute lock on
      the same scope.
- [x] Execute locks conflict with existing execute or write locks on the same
      scope.
- [x] Storage-specific file locks remain implementation details behind an
      adapter.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60384-work-command-surface-and-scoperef-canonicalization]]

## Relationships

- `depends_on`: `[[60384-work-command-surface-and-scoperef-canonicalization]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]`
