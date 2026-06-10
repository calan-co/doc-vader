---
id: wi-60326
title: Concurrent Claim and Dependency-Aware Selection
type: work-item
subtype: story
lifecycle: active
status: ready
priority: high
estimated: 5
links:
  depends_on:
    - '[[237-doc-vader-context-coordination-core-epic.md]]'
    - '[[238-governed-lifecycle-and-fail-closed-readiness.md]]'
  evidence:
    - '[[record-20260610-202104-60326]]'
tags:
  - concurrency
  - claims
  - selection
  - dependencies
---

## Goal

Let multiple human and AI contributors claim work safely and select only dependency-satisfied items, so parallel execution does not create overlap or order violations.

## Background

The PRD explicitly calls for concurrency-safe identifiers, claim/lease-friendly execution boundaries, and dependency-aware ready selection. This slice is the parallelism lane: it keeps contributors from colliding while still letting the ready queue advance.

## Tasks

- Define claim and scope boundary semantics for concurrent contributors.
- Prevent accidental overlap between simultaneous executors.
- Ensure ready selection only surfaces unblocked work.
- Add conflict and collision tests for concurrent execution paths.

## Deliverables

- Claim/lease semantics for execution scopes.
- Dependency-aware ready selection behavior.
- Collision-avoidance tests for concurrent contributors.

## Acceptance Criteria

- [ ] Multiple contributors can claim disjoint work without conflict.
- [ ] Overlapping claims are blocked deterministically.
- [ ] Only dependency-satisfied items are eligible for ready selection.
- [ ] Concurrency guard behavior is covered by targeted tests.
