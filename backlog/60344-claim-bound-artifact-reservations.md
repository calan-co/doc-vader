---
id: wi-60344
title: Deferred Claim Bound Artifact Reservations
summary: Preserve future claim-bound artifact reservation semantics after MVP claim-owned file locks and path normalization land.
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
    - '[[60374-lock-command-surface]]'
    - '[[60375-lock-path-normalization-and-rename-gate]]'
  evidence:
    - '[[record-20260614-164457-60344]]'
tags:
  - afk
  - sandcastle
  - command-surface
  - claims
---

## Goal

Preserve future artifact reservation behavior without making it an MVP dependency.

## Background

The architecture session moved claim-bound artifact reservations out of MVP. The MVP rule is file-based: every changed file in the branch/worktree diff must be locked by the active claim through normalized repo-relative file paths. Future artifact reservations can reintroduce graph and nested-artifact semantics once [[60340-artifact-graph-and-nested-claim-architecture-adr]] is complete.

## Tasks

- [ ] Define future artifact-ref resolution against the deferred graph model.
- [ ] Define future reservation add/remove command contracts without adding them to the MVP command surface.
- [ ] Make multi-ref add atomic: if any ref is outside scope or conflicting, reserve none.
- [ ] Define future auto-reservation behavior only when the artifact is inside the approved graph and conflict-free.
- [ ] Define structured rejection reasons for future reservation attempts outside the approved graph.
- [ ] Cover inside-scope, outside-scope, conflicting, repeated, multi-ref atomic, remove, and dry-run behavior in tests.

## Deliverables

- Future claim-bound reservation add/remove command contract.
- Mapping from MVP file locks to future artifact-reservation concepts.
- Tests for artifact reservation conflict and fail-closed behavior.

## Acceptance Criteria

- [ ] Mutating commands can verify that every mutated artifact is reserved by the active claim.
- [ ] `claim add` atomically reserves one or more artifact refs only when every ref is inside the claim scope and conflict-free.
- [ ] Future reservation commands reject refs outside the approved graph instead of expanding the claim.
- [ ] Future reservation commands release claim-bound artifact reservations without changing the immutable graph.
- [ ] Auto-reservation, where implemented, follows the same scope-membership and conflict rules.
- [ ] Section-level artifact reservations are not introduced before [[60340-artifact-graph-and-nested-claim-architecture-adr]] is complete.

## Blocked By

[[60372-supersede-single-agent-mvp-items]]
