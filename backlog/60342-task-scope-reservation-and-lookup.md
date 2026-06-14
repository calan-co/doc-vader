---
id: wi-60342
title: Task Scope Reservation and Lookup
summary: Implement immutable scope graph reservation, hashing, storage, and lookup commands so claims can bind to an approved task execution boundary.
type: work-item
subtype: story
lifecycle: active
status: ready
priority: critical
estimated: 5
links:
  depends_on:
    - '[[60341-task-ready-afk-eligibility-query]]'
  reference:
    - '[[60339-agent-command-surface-for-skills-and-sandcastle]]'
    - '[[60340-artifact-graph-and-nested-claim-architecture-adr]]'
  evidence:
    - '[[record-20260614-164457-60342]]'
tags:
  - afk
  - sandcastle
  - command-surface
  - scope-graph
---

## Goal

Add immutable scope graph reservation and lookup for task execution claims.

## Background

The MVP claim model uses an explicit scope graph rather than an implicit task ID or mutable scope payload. `reserve` creates, validates, stores, or recovers a content-addressed scope graph and returns a `scope_hash`. Active claims reference a scope hash and cannot expand it in place.

## Tasks

- [ ] Define the MVP canonical scope graph payload and stable JSON canonicalization rules.
- [ ] Store local scope graphs in the configured runtime store, such as `.doc-vader/runtime/`, without committing runtime state.
- [ ] Implement `dv task reserve <task-id> [--payload <json-or-file>] [--dry-run] [--json|--porcelain]`.
- [ ] Implement `dv task scopes <task-id> [--json]` for lookup and recovery.
- [ ] Implement `dv task scope <scope-hash> [--json]` for graph inspection.
- [ ] Implement scope derivation commands that create a new hash when adding or removing artifact refs without mutating the existing graph.
- [ ] Reject reservation for work known to be unclaimable.
- [ ] Cover stable hash, duplicate payload, malformed payload, unclaimable task, dry-run, and lookup behavior in tests.

## Deliverables

- Scope graph canonicalization and hashing support.
- Local scope graph store abstraction ready for hosted replacement.
- `dv task reserve`, `dv task scopes`, `dv task scope`, and scope derivation CLI commands.
- Tests for deterministic storage, lookup, and fail-closed reservation.

## Acceptance Criteria

- [ ] Identical canonical scope graphs produce the same `scope_hash`; changed scope graphs produce a new hash.
- [ ] `reserve` stores or recovers a scope graph and returns a hash without creating an execution claim.
- [ ] `--dry-run` reports the would-be hash and validation result without persisting state.
- [ ] Scope lookup commands can recover previously stored graphs by task ID or hash.
- [ ] Scope derivation produces a new graph hash and never mutates an existing hash.
- [ ] The implementation does not introduce section-level claims; nested artifact behavior remains deferred to [[60340-artifact-graph-and-nested-claim-architecture-adr]].

## Blocked By

[[60341-task-ready-afk-eligibility-query]]
