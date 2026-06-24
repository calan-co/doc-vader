---
id: wi-60344
title: Deferred Claim Bound Artifact Reservations
summary: Preserve future claim-bound artifact reservation semantics after MVP claim-owned file locks and path normalization land.
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: low
estimated: 5
actual: 5
completed_date: '2026-06-23'
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

The current MVP successor chain is [[60361-git-sqlite-local-multi-agent-runtime-contract]] plus the claim, lock, and path-normalization slices in [[60373-claim-command-surface]], [[60374-lock-command-surface]], and [[60375-lock-path-normalization-and-rename-gate]].

## Deferred Contract

Future claim-bound artifact reservations stay behind the artifact graph seam and do not expand the MVP claim boundary.

- Artifact refs resolve through the deferred graph model instead of widening the current file/document atomicity rule.
- Future artifact reservation commands remain follow-on surface area, not part of the MVP command set.
- Multi-ref reservation adds are all-or-none: any outside-scope, conflicting, or otherwise invalid ref rejects the whole batch.
- Auto-reservation, when implemented, may only apply to artifacts already inside the approved graph and conflict-free.
- Structured rejection reasons should distinguish outside-graph, conflict, repeated, and dry-run failures.
- Future validation should cover inside-scope, outside-scope, conflicting, repeated, multi-ref atomic, remove, and dry-run cases.

## Tasks

- [x] Define future artifact-ref resolution against the deferred graph model.
- [x] Define future reservation add/remove command contracts without adding them to the MVP command surface.
- [x] Make multi-ref add atomic: if any ref is outside scope or conflicting, reserve none.
- [x] Define future auto-reservation behavior only when the artifact is inside the approved graph and conflict-free.
- [x] Define structured rejection reasons for future reservation attempts outside the approved graph.
- [x] Cover inside-scope, outside-scope, conflicting, repeated, multi-ref atomic, remove, and dry-run behavior in tests.

## Deliverables

- [x] Future claim-bound reservation add/remove command contract.
- [x] Mapping from MVP file locks to future artifact-reservation concepts.
- [x] Tests for artifact reservation conflict and fail-closed behavior.

## Acceptance Criteria

- [x] Mutating commands can verify that every mutated artifact is reserved by the active claim.
- [x] `claim add` atomically reserves one or more artifact refs only when every ref is inside the claim scope and conflict-free.
- [x] Future reservation commands reject refs outside the approved graph instead of expanding the claim.
- [x] Future reservation commands release claim-bound artifact reservations without changing the immutable graph.
- [x] Auto-reservation, where implemented, follows the same scope-membership and conflict rules.
- [x] Section-level artifact reservations are not introduced before [[60340-artifact-graph-and-nested-claim-architecture-adr]] is complete.

## Dependencies

[[60372-supersede-single-agent-mvp-items]]
