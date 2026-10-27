---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60521
title: Unify Historical Reconciliation as a Closure Protocol
summary: Replace per-command historical-change exemptions with one immutable, verified reconciliation manifest consumed by evidence, transition, and release.
type: work-item
subtype: epic
lifecycle: active
status: ready
status_reason: planned
priority: critical
links:
  reference:
    - https://github.com/calan-co/doc-vader/pull/119
    - https://github.com/calan-co/doc-vader/pull/122
tags:
  - afk
  - reconciliation
  - runtime
  - provenance
---

## Goal

Make verified historical reconciliation the sole authority for closing already-published work without retroactive locks.

## Architecture

Create one immutable reconciliation manifest that binds the work item, source kind, repository, immutable commit, published ref, exact changed-path manifest and digest, and linked CI/review evidence. Source adapters produce the same manifest:

- `merged-pr` requires a merged PR URL.
- `direct-push` is disabled by default and requires project-local policy, current GitHub admin verification, protected-ref reachability, exact manifest, and immutable admin receipt.

All later operations (`work record`, completion, and claim release) resolve the same verified manifest. Current-claim audit covers only current writes; historical audit covers only manifest paths. Runtime internals are excluded from repository-state restoration.

## Acceptance Criteria

- [ ] A single manifest resolver is the only historical-path exemption authority.
- [ ] Source adapters fail closed and cannot alter GitHub protection.
- [ ] Evidence, completion, and release share one end-to-end protocol test.
- [ ] The legacy fixture proves no retroactive locks, no foreign-path exemption, validated backlog, and released runtime state.
- [ ] Node 22/24 CI requires the full protocol fixture for reconciliation, recovery, record, transition, and release changes.

## Tasks

- [ ] Refactor existing merged-PR reconciliation to persist and resolve one manifest contract.
- [ ] Complete WI-60520 direct-push source adapter.
- [ ] Replace command-local historical exemptions with the resolver.
- [ ] Add the legacy merged-change end-to-end contract fixture and CI ownership gate.
- [ ] Publish migration guidance and deprecate command-local exceptions.
