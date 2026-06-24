---
id: wi-60380
title: Deterministic Backlog Review Profile
summary: Implement the first Work Item backlog review profile on top of the shared composable evaluation framework.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 4
actual: 4
completed_date: '2026-06-23'
links:
  depends_on:
    - '[[60383-composable-evaluation-framework-foundation]]'
  reference:
    - '[[../docs/architecture/decisions/adr-005-entity-governance-primitive-model.md]]'
    - '[[../docs/architecture/decisions/adr-010-composable-evaluation-primitives.md]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
  supporting_reference:
    - '[[record-wi-60380-validation]]'
  evidence:
    - '[[record-20260624-234349-60380]]'
tags:
  - afk
  - backlog
  - review
  - findings
  - command-surface
---

## Goal

Implement the first store-specific review profile by making backlog review a
composition of deterministic checks over Work Item entities and backlog records
using the shared composable evaluation framework.

## Background

The entity-governance language now treats backlog review as a Work Item review
profile, not a bespoke primitive. The shared framework is implemented separately
by `60383`; this item wires Work Item governance, backlog parsing, and current
task-readiness behavior into that framework.

This slice is AFK after `60383` because it is implementation of accepted
vocabulary and deterministic Work Item behavior. It must not introduce reasoned
synthesis or lifecycle promotion logic.

## Tasks

- [x] Register the backlog review profile against the shared evaluation
      framework.
- [x] Define the backlog profile scope, checks, Work Item reason codes, and
      report summary fields.
- [x] Compose deterministic checks for schema validity, lifecycle/status
      compatibility, link resolution, dependency satisfaction, AFK/HITL
      classification, evidence readiness, archive exclusion, and runtime
      selection blockers.
- [x] Add or adapt a non-mutating CLI surface for running the backlog review
      profile with JSON output.
- [x] Return findings grouped by subject, check, severity, and blocking status.
- [x] Return deterministic summaries such as counts, candidate sets, excluded
      sets, dependency-blocked sets, HITL sets, and missing-classification sets.
- [x] Ensure the command does not mark checkboxes, alter tags, transition work
      items, create claims, or write records by default.
- [x] Add focused tests for deterministic report stability and non-mutation.

## Deliverables

- Backlog review profile implementation.
- CLI command or command option for deterministic backlog review JSON output.
- Backlog-specific finding reason codes and report summary fields.
- Tests proving deterministic output and non-mutating behavior.

## Acceptance Criteria

- [x] Backlog review is represented as a Work Item review profile composed from
      shared checks.
- [x] Each failed or noteworthy check produces a finding with stable reason
      codes.
- [x] The report contains deterministic summaries only.
- [x] The command can identify AFK-ready, HITL, dependency-blocked, invalid,
      archived, closed, and missing-classification work without mutating files.
- [x] Tests prove repeated runs over the same inputs produce the same report.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `pnpm run backlog:validate`.

## Relationships

- `depends_on`: `[[60383-composable-evaluation-framework-foundation]]`
