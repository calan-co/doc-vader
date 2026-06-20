---
id: wi-60342
title: Deferred Task Scope Reservation and Lookup
summary: Preserve future immutable scope graph reservation, hashing, storage, and lookup design after the MVP runtime uses claim-owned repo-relative file locks.
type: work-item
subtype: story
lifecycle: active
status: paused
status_reason: blocked
priority: low
estimated: 5
links:
  depends_on:
    - '[[60372-supersede-single-agent-mvp-items]]'
  reference:
    - '[[60339-agent-command-surface-for-skills-and-sandcastle]]'
    - '[[60340-artifact-graph-and-nested-claim-architecture-adr]]'
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
  evidence:
    - '[[record-20260614-164457-60342]]'
tags:
  - afk
  - sandcastle
  - command-surface
  - scope-graph
---

## Goal

Preserve immutable scope graph reservation and lookup as a future capability after the MVP runtime spine lands.

## Background

The architecture session moved scope graphs out of MVP. MVP claim ownership is represented by a generic target claim plus claim-owned repo-relative file locks in the Git plus SQLite runtime authority. This item now captures the deferred graph-reservation model so it can be reintroduced later through storage and format adapters without constraining the MVP claim path.

Architectural context: `docs/architecture/decisions/adr-009-storage-and-format-seams.md`.

## Tasks

- [ ] Define the future canonical scope graph payload and stable JSON canonicalization rules.
- [ ] Store local scope graphs in the configured runtime store, such as `.doc-vader/runtime/`, without committing runtime state.
- [ ] Define future `reserve`, `scopes`, `scope`, and scope-derivation command contracts without adding them to the MVP command surface.
- [ ] Reject reservation for work known to be unclaimable.
- [ ] Cover stable hash, duplicate payload, malformed payload, unclaimable task, dry-run, and lookup behavior in tests.

## Deliverables

- Deferred scope graph canonicalization and hashing design.
- Storage and format adapter requirements for any future scope graph store.
- Command contract notes for future `reserve`, `scopes`, `scope`, and scope derivation commands.
- Tests for deterministic storage, lookup, and fail-closed reservation.

## Acceptance Criteria

- [ ] Identical canonical scope graphs produce the same `scope_hash`; changed scope graphs produce a new hash.
- [ ] `reserve` stores or recovers a scope graph and returns a hash without creating an execution claim.
- [ ] `--dry-run` reports the would-be hash and validation result without persisting state.
- [ ] Scope lookup commands can recover previously stored graphs by task ID or hash.
- [ ] Scope derivation produces a new graph hash and never mutates an existing hash.
- [ ] The implementation does not introduce section-level claims; nested artifact behavior remains deferred to [[60340-artifact-graph-and-nested-claim-architecture-adr]].

## Blocked By

[[60372-supersede-single-agent-mvp-items]]
