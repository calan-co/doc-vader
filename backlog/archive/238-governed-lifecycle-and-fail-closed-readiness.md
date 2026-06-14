---
id: wi-60325
title: Governed Lifecycle and Fail-Closed Readiness
type: work-item
subtype: story
lifecycle: active
status: closed
status_reason: completed
priority: high
estimated: 5
actual: 1
completed_date: '2026-06-09'
links:
  depends_on:
    - '[[237-doc-vader-context-coordination-core-epic.md]]'
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/59
  evidence:
    - '[[record-20260610-202104-60325]]'
tags:
  - readiness
  - lifecycle
  - afk
  - governance
---

## Goal

Make doc-vader readiness, pause, and resume behavior explicit and machine-verifiable so execution fails closed when required evidence is missing or stale.

## Background

The PRD requires top-level lifecycle states, ready substatus semantics, immutable execution scope privileges snapshots, immutable CCQ references, and deterministic triage packets for interruption handling. This slice owns the lifecycle contract that decides what can run now and what must pause.

## Tasks

- [x] Defined the readiness and pause state model for the new context-coordination flow.
- [x] Required immutable execution scope privileges and CCQ references before a run can start.
- [x] Implemented fail-closed behavior when evidence, alias resolution, or canonical context is missing.
- [x] Emitted deterministic triage guidance for blocked, policy, system, and manual pauses.

## Deliverables

- Governed lifecycle state semantics.
- Fail-closed readiness checks.
- Pause and recovery guidance that is deterministic and auditable.

## Acceptance Criteria

- [x] Readiness is explicit and does not rely on implicit defaults.
- [x] Missing required evidence blocks execution.
- [x] Execution scope privileges and CCQ references are treated as immutable run authorization artifacts.
- [x] Pause and resume behavior is documented and testable.
