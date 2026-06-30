---
id: wi-60416
title: End-To-End Sandcastle Smoke And Recovery
summary: Prove generated Sandcastle scaffold behavior across selection, claim, lock, record, close, release, and recovery.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 6
links:
  depends_on:
    - '[[60414-sandcastle-init-templateargs-wiring]]'
    - '[[60415-authoritative-dv4sandcastle-documentation]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-sandcastle-ready-work-cli-prd.md]]'
tags:
  - afk
  - sandcastle
  - testing
  - work-management
---

## Goal

Prove Doc-Vader is Sandcastle-ready with an end-to-end smoke that exercises the
generated scaffold and partial-state recovery path.

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

- [ ] Add a generated-scaffold smoke for Sandcastle planning and inspection.
- [ ] Exercise claim acquisition and lock guidance or verification.
- [ ] Exercise evidence or record creation for a claimed work item.
- [ ] Exercise close, transition, release, and terminal handling.
- [ ] Simulate interrupted or dirty partial state.
- [ ] Verify recovery classifies the partial state and makes safe progress.
- [ ] Add the smoke to an appropriate validation command or document why it is
      intentionally focused.

## Deliverables

- End-to-end Sandcastle readiness smoke.
- Partial-state recovery coverage.
- Validation evidence that the generated scaffold uses the adapter surfaces.

## Acceptance Criteria

- [ ] The smoke covers planning list, inspection, claim, lock, record, close,
      release, and recovery behavior.
- [ ] The smoke uses generated Sandcastle artifacts or the same contract they
      expose.
- [ ] Interrupted or dirty partial state is recovered before new execution is
      considered safe.
- [ ] The smoke proves Sandcastle does not rely on the legacy JSON claim store.
- [ ] The smoke proves Sandcastle does not use stale ad hoc list or view helper
      scripts.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `doc-vader backlog validate --dir backlog --fail-on error`.
- [ ] Validation passes with `pnpm run backlog:validate:ci`.

## Blocked by

- [[60414-sandcastle-init-templateargs-wiring]]
- [[60415-authoritative-dv4sandcastle-documentation]]

## Relationships

- `depends_on`: `[[60414-sandcastle-init-templateargs-wiring]]`
- `depends_on`: `[[60415-authoritative-dv4sandcastle-documentation]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-sandcastle-ready-work-cli-prd.md]]`
