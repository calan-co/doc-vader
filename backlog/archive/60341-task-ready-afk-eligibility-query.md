---
id: wi-60341
title: Task Ready AFK Eligibility Query
summary: Implement the `dv task ready` query so Sandcastle and skills can select only AFK, unclaimed, runtime-pass work items with stable human, JSON, and porcelain output.
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 5
actual: 1
completed_date: '2026-06-18'
commits:
  ebc011c73c333729b7ea4ae7ba95810c3f1272a0: 'chore(backlog): consolidate active work item backlog'
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/60
  reference:
    - '[[60339-agent-command-surface-for-skills-and-sandcastle]]'
    - '[[60330-unified-remark-validation-pipeline]]'
    - '[[60333-canonical-schema-profile-routing-and-fixtures]]'
  evidence:
    - '[[record-20260614-164457-60341]]'
    - '[[record-sandcastle-task-validation-passed]]'
tags:
  - afk
  - sandcastle
  - command-surface
  - task-cli
---

## Goal

Add the deterministic `dv task ready` command that exposes only work items safe for AFK execution.

## Background

Sandcastle must not select HITL, blocked, unknown, invalid, archived, closed, dependency-blocked, or already-claimed work. The parent contract in [[60339-agent-command-surface-for-skills-and-sandcastle]] defines `ready` as a named query over canonical AFK and runtime gate filters. This slice implements that query without adding claim mutation behavior.

## Tasks

- [x] Resolve task candidates through the canonical backlog/work-item loader instead of ad hoc file scanning.
- [x] Normalize AFK/HITL classification before applying guard logic, failing closed for missing, unknown, invalid, or HITL values.
- [x] Exclude archived, closed, blocked, dependency-blocked, invalid, and already-claimed tasks.
- [x] Run the runtime gates needed for Sandcastle-ready selection without mutating claims.
- [x] Emit human-readable output by default, stable machine output with `--json`, and script-friendly output with `--porcelain`.
- [x] Cover AFK, HITL, blocked dependency, invalid classification, and already-claimed fixtures in tests.

## Deliverables

- `dv task ready` CLI command.
- Library-level ready-query function usable by future adapters.
- Tests for filtering, output formats, and fail-closed behavior.

## Acceptance Criteria

- [x] `dv task ready` returns only AFK, unclaimed, runtime-pass active tasks.
- [x] HITL, unknown, invalid, blocked, dependency-blocked, archived, closed, and claimed tasks are excluded with structured reasons available in JSON output.
- [x] Default output is human-readable; `--json` and `--porcelain` are deterministic.
- [x] The command does not create, renew, release, or mutate claims.
- [x] Tests prove fail-closed behavior for missing or unsupported classification data.

## Blocked By

None - can start immediately.
