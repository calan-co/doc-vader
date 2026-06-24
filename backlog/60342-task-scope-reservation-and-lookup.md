---
id: wi-60342
title: Deferred Task Scope Reservation and Lookup
summary: Preserve future immutable scope graph reservation, hashing, storage, and lookup design after the MVP runtime uses claim-owned repo-relative file locks.
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: low
estimated: 5
actual: 1
completed_date: '2026-06-24'
links:
  depends_on:
    - '[[60372-supersede-single-agent-mvp-items]]'
  reference:
    - '[[60339-agent-command-surface-for-skills-and-sandcastle]]'
    - '[[60340-artifact-graph-and-nested-claim-architecture-adr]]'
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
    - '[[60373-claim-command-surface]]'
    - '[[60374-lock-command-surface]]'
    - '[[60375-lock-path-normalization-and-rename-gate]]'
  evidence:
    - '[[record-20260614-164457-60342]]'
    - '[[record-20260623-60342-scope-graph-contract]]'
tags:
  - afk
  - sandcastle
  - command-surface
  - scope-graph
---

## Goal

Preserve immutable scope graph reservation and lookup as a future capability after the MVP runtime spine lands.

## Background

The architecture session moved scope graphs out of MVP. MVP claim ownership is represented by a generic target claim plus claim-owned repo-relative file locks in the Git plus SQLite runtime authority. This item now captures the deferred graph-reservation model so it can be reintroduced later through storage and format adapters without constraining the MVP claim path. The deferred contract is recorded in [[record-20260623-60342-scope-graph-contract]].

The current runtime path is defined by [[60361-git-sqlite-local-multi-agent-runtime-contract]] and its command slices in [[60373-claim-command-surface]], [[60374-lock-command-surface]], and [[60375-lock-path-normalization-and-rename-gate]].

Architectural context: `docs/architecture/decisions/adr-009-storage-and-format-seams.md`.

## Tasks

- [x] Define the future canonical scope graph payload and stable JSON canonicalization rules.
- [x] Store local scope graphs in the configured runtime store, such as `.doc-vader/runtime/`, without committing runtime state.
- [x] Define future `reserve`, `scopes`, `scope`, and scope-derivation command contracts without adding them to the MVP command surface.
- [x] Reject reservation for work known to be unclaimable.
- [x] Cover stable hash, duplicate payload, malformed payload, unclaimable task, dry-run, and lookup behavior in tests.

## Deliverables

- [x] Deferred scope graph canonicalization and hashing design.
- [x] Storage and format adapter requirements for any future scope graph store.
- [x] Command contract notes for future `reserve`, `scopes`, `scope`, and scope derivation commands.
- [x] Tests for deterministic storage, lookup, and fail-closed reservation.

## Acceptance Criteria

- [x] Identical canonical scope graphs produce the same `scope_hash`; changed scope graphs produce a new hash.
- [x] `reserve` stores or recovers a scope graph and returns a hash without creating an execution claim.
- [x] `--dry-run` reports the would-be hash and validation result without persisting state.
- [x] Scope lookup commands can recover previously stored graphs by task ID or hash.
- [x] Scope derivation produces a new graph hash and never mutates an existing hash.
- [x] The implementation does not introduce section-level claims; nested artifact behavior remains deferred to [[60340-artifact-graph-and-nested-claim-architecture-adr]].

## Dependencies

[[60372-supersede-single-agent-mvp-items]]
