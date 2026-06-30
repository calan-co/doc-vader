---
id: wi-60412
title: Sandcastle Claim And Recovery Surface
summary: Deliver dv4sandcastle claim, release, lock guidance, and recover over dv runtime authority.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 6
links:
  depends_on:
    - '[[60410-sandcastle-planning-list-surface]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-sandcastle-ready-work-cli-prd.md]]'
tags:
  - afk
  - sandcastle
  - runtime
  - work-management
---

## Goal

Make Sandcastle claim, release, lock guidance, and recovery behavior flow
through `dv` runtime authority instead of adapter-local claim state.

## Background

The current Sandcastle-facing adapter still contains legacy JSON claim-store
behavior. That creates split-brain recovery risk because Doc-Vader's authority
for local execution is Git plus SQLite runtime state. The claim tracer bullet
must prove interrupted work can be classified and recovered without a second
claim store.

## What to build

Provide `dv4sandcastle claim`, release, lock verification or guidance, and
recover commands that use `dv` runtime commands and state. The adapter should be
thin translation, not a lifecycle authority, and should revalidate selected work
before execution starts.

## Tasks

- [ ] Add or update `dv4sandcastle claim` over native runtime claim behavior.
- [ ] Add or update release behavior over native runtime release semantics.
- [ ] Surface lock guidance or verification through the adapter without owning
      lock state.
- [ ] Add or update adapter recovery behavior over `dv work recover`.
- [ ] Remove legacy adapter-local JSON claim-store behavior.
- [ ] Revalidate selected work before claim acquisition.
- [ ] Add integration coverage for claim conflicts, release, and recoverable
      partial state.

## Deliverables

- Sandcastle-compatible claim and release behavior.
- Adapter recovery path over `dv` runtime authority.
- Tests proving the legacy JSON claim store is not used.

## Acceptance Criteria

- [ ] Sandcastle can claim selected work through `dv4sandcastle claim`.
- [ ] Claims and releases are persisted through Doc-Vader runtime authority.
- [ ] Lock guidance or verification is derived from `dv` runtime state.
- [ ] Recoverable interrupted work is routed through `dv work recover`.
- [ ] The adapter no longer reads or writes legacy JSON claim-store state.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `doc-vader backlog validate --dir backlog --fail-on error`.

## Blocked by

- [[60410-sandcastle-planning-list-surface]]

## Relationships

- `depends_on`: `[[60410-sandcastle-planning-list-surface]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-sandcastle-ready-work-cli-prd.md]]`
