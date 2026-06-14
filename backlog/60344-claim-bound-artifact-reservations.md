---
id: wi-60344
title: Claim Bound Artifact Reservations
summary: Implement claim-bound artifact reservation add and remove commands that enforce approved scope membership before any artifact mutation.
type: work-item
subtype: story
lifecycle: active
status: ready
priority: high
estimated: 5
links:
  depends_on:
    - '[[60343-task-claim-store-and-lifecycle]]'
  reference:
    - '[[60339-agent-command-surface-for-skills-and-sandcastle]]'
    - '[[60340-artifact-graph-and-nested-claim-architecture-adr]]'
  evidence:
    - '[[record-20260614-164243-60344]]'
tags:
  - afk
  - sandcastle
  - command-surface
  - claims
---

## Goal

Require every mutated artifact to be covered by a claim-bound reservation.

## Background

The MVP does not need separate output, context, or work expansion rules. The same rule applies to every scope lane: a reservation or mutation is allowed only when the artifact ref resolves inside the approved bounding scope graph. This preserves the benefit of a bounding graph while avoiding discrete per-output lease complexity.

## Tasks

- [ ] Implement artifact-ref resolution against the MVP scope graph model.
- [ ] Implement `dv task claim <claim-id> add <artifact-ref>... [--dry-run] [--json|--porcelain]`.
- [ ] Implement `dv task claim <claim-id> remove <artifact-ref>... [--dry-run] [--json|--porcelain]`.
- [ ] Make multi-ref add atomic: if any ref is outside scope or conflicting, reserve none.
- [ ] Allow auto-reservation on mutation only when the artifact is inside the approved scope graph and conflict-free.
- [ ] Reject all reservation attempts outside the approved scope graph with structured reasons.
- [ ] Cover inside-scope, outside-scope, conflicting, repeated, multi-ref atomic, remove, and dry-run behavior in tests.

## Deliverables

- Claim-bound reservation add/remove commands.
- Scope membership guard used by mutation paths.
- Tests for artifact reservation conflict and fail-closed behavior.

## Acceptance Criteria

- [ ] Mutating commands can verify that every mutated artifact is reserved by the active claim.
- [ ] `claim add` atomically reserves one or more artifact refs only when every ref is inside the claim scope and conflict-free.
- [ ] `claim add` rejects refs outside the approved scope graph instead of expanding the claim.
- [ ] `claim remove` releases claim-bound artifact reservations without changing the immutable scope graph.
- [ ] Auto-reservation, where implemented, follows the same scope-membership and conflict rules.
- [ ] Section-level artifact reservations are not introduced before [[60340-artifact-graph-and-nested-claim-architecture-adr]] is complete.

## Blocked By

[[60343-task-claim-store-and-lifecycle]]
