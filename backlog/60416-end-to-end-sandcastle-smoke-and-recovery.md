---
id: wi-60416
title: End-To-End Sandcastle Smoke And Recovery
summary: Prove generated Sandcastle scaffold behavior across selection, claim, lock, record, close, release, and recovery.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 6
completed_date: '2026-06-30'
links:
  depends_on:
    - '[[60414-sandcastle-init-templateargs-wiring]]'
    - '[[60415-authoritative-dv4sandcastle-documentation]]'
    - '[[60417-work-ready-dependency-resolver-mismatch]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-sandcastle-ready-work-cli-prd.md]]'
  evidence:
    - '[[task-record-preflight|2026-06-30: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.]]'
    - '[[record-wi-60416-sandcastle-smoke|2026-06-30 smoke evidence]]'
    - '[[record-wi-60416-sandcastle-smoke]]'
tags:
  - afk
  - sandcastle
  - testing
  - work-management
---

## Goal

Prove Doc-Vader is Sandcastle-ready with an end-to-end smoke that exercises the
generated scaffold and partial-state recovery path.

## Notes

- 2026-06-30: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.

## Background

The adapter is only trustworthy once selection, inspection, claim, lock,
record, transition, release, and recovery work together through generated
Sandcastle artifacts. Unit-level command coverage is useful, but the readiness
gate is the integrated AFK path.

## What to build

Add an end-to-end Sandcastle smoke or equivalent integration harness that uses
the generated adapter-backed scaffold. The smoke should cover the successful
path and an interrupted or dirty partial-state path that must recover before
new execution proceeds.

## Tasks

- [x] Add a generated-scaffold smoke for Sandcastle planning and inspection.
- [x] Exercise claim acquisition and lock guidance or verification.
- [x] Exercise evidence or record creation for a claimed work item.
- [x] Exercise close, transition, release, and terminal handling.
- [x] Simulate interrupted or dirty partial state.
- [x] Verify recovery classifies the partial state and makes safe progress.
- [x] Add the smoke to an appropriate validation command or document why it is
      intentionally focused.

## Deliverables

- End-to-end Sandcastle readiness smoke.
- Partial-state recovery coverage.
- Validation evidence that the generated scaffold uses the adapter surfaces.

## Acceptance Criteria

- [x] The smoke covers planning list, inspection, claim, lock, record, close,
      release, and recovery behavior.
- [x] The smoke uses generated Sandcastle artifacts or the same contract they
      expose.
- [x] Interrupted or dirty partial state is recovered before new execution is
      considered safe.
- [x] The smoke proves Sandcastle does not rely on the legacy JSON claim store.
- [x] The smoke proves Sandcastle does not use stale ad hoc list or view helper
      scripts.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `doc-vader backlog validate --dir backlog --fail-on error`.
- [x] Validation passes with `pnpm run backlog:validate:ci`.

## Relationships

- `depends_on`: `[[60414-sandcastle-init-templateargs-wiring]]`
- `depends_on`: `[[60415-authoritative-dv4sandcastle-documentation]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-sandcastle-ready-work-cli-prd.md]]`
