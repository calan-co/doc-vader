---
id: wi-60341
title: Task Ready AFK Eligibility Query
summary: Implement the `dv task ready` query so Sandcastle and skills can select only AFK, unclaimed, runtime-pass work items with stable human, JSON, and porcelain output.
type: work-item
subtype: story
lifecycle: active
status: in-progress
status_reason: implementation
priority: critical
estimated: 5
links:
  pull_requests:
    - 'https://github.com/calan-co/doc-vader/pull/60'
  reference:
    - '[[60339-agent-command-surface-for-skills-and-sandcastle]]'
    - '[[60330-unified-remark-validation-pipeline]]'
    - '[[60333-canonical-schema-profile-routing-and-fixtures]]'
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

- [ ] Resolve task candidates through the canonical backlog/work-item loader instead of ad hoc file scanning.
- [ ] Normalize AFK/HITL classification before applying guard logic, failing closed for missing, unknown, invalid, or HITL values.
- [ ] Exclude archived, closed, blocked, dependency-blocked, invalid, and already-claimed tasks.
- [ ] Run the runtime gates needed for Sandcastle-ready selection without mutating claims.
- [ ] Emit human-readable output by default, stable machine output with `--json`, and script-friendly output with `--porcelain`.
- [ ] Cover AFK, HITL, blocked dependency, invalid classification, and already-claimed fixtures in tests.

## Deliverables

- `dv task ready` CLI command.
- Library-level ready-query function usable by future adapters.
- Tests for filtering, output formats, and fail-closed behavior.

## Acceptance Criteria

- [ ] `dv task ready` returns only AFK, unclaimed, runtime-pass active tasks.
- [ ] HITL, unknown, invalid, blocked, dependency-blocked, archived, closed, and claimed tasks are excluded with structured reasons available in JSON output.
- [ ] Default output is human-readable; `--json` and `--porcelain` are deterministic.
- [ ] The command does not create, renew, release, or mutate claims.
- [ ] Tests prove fail-closed behavior for missing or unsupported classification data.

## Blocked By

None - can start immediately.
