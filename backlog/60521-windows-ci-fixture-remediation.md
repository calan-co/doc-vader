---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60521
title: Windows CI Fixture Remediation
summary: Isolate built CLI fixtures, retain production-artifact coverage, and make Windows diagnostic worker commands compatible with the current Vitest CLI.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
completed_date: '2026-10-27'
links:
  reference:
    - '[[60495-investigate-windows-node-22-ci-flakiness]]'
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/126
tags:
  - ci
  - windows
  - testing
---

## Goal

Deliver the bounded test-fixture and diagnostic-command remediation without closing the broader Windows flakiness investigation.

## Tasks

- [x] Isolate built CLI fixture setup and idempotent cleanup outside measured test bodies.
- [x] Preserve production-artifact public CLI assertions.
- [x] Add opt-in structured Git, CLI, SQLite, and filesystem cleanup timings.
- [x] Replace unsupported Vitest worker flags and validate the 2/4-worker stress design.

## Deliverables

- Isolated built CLI integration fixtures.
- Opt-in newline-delimited JSON timing records.
- A current-Vitest-compatible Windows diagnostic probe plan.

## Acceptance Criteria

- [x] Built CLI tests use independent temporary roots and clean up idempotently.
- [x] Timings are off by default and structured when explicitly enabled.
- [x] Focused, Node 22, and 2/4-worker validation pass without enabling Windows file parallelism.

## Relationships

- `reference`: `wi-60495` Note: This bounded remediation supplies fixture and diagnostic improvements while the broader investigation remains open.
