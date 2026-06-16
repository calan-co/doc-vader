---
id: wi-60356
title: Fail Closed Ready Selection CLI
summary: Implement `dv task ready` so Sandcastle can select only AFK-ready, dependency-satisfied, validation-clean, unclaimed work items with deterministic output.
type: work-item
subtype: story
lifecycle: active
status: paused
status_reason: blocked
priority: critical
estimated: 6
links:
  depends_on:
    - '[[60354-canonical-task-model-show-and-prompt]]'
    - '[[60355-simple-local-claim-lock]]'
  reference:
    - '[[60341-task-ready-afk-eligibility-query]]'
  evidence:
    - '[[record-20260616-043441-60356]]'
tags:
  - afk
  - sandcastle
  - dogfood
  - command-surface
  - task-cli
---

## Parent

[Sandcastle Dogfood Command Surface PRD](../docs/how-to/implementation-plans/sandcastle-dogfood-command-surface-prd.md)

## What to build

Add `dv task ready` as the Sandcastle selection command. It should use the canonical task model and local claim store to return only tasks that are safe to start in the dogfood MVP: active, ready, AFK, not HITL, dependency-satisfied, validation-clean, and not actively claimed.

## Acceptance criteria

- [x] `dv task ready --json` returns deterministic machine-readable candidates with task metadata and no mutation side effects.
- [x] `dv task ready --porcelain` returns stable script-friendly output.
- [x] HITL, missing classification, invalid, archived, closed, blocked, dependency-blocked, and actively claimed tasks are excluded.
- [x] JSON output includes structured exclusion reasons or a deterministic way to inspect why candidates were not selected.
- [x] The command fails closed when validation or dependency state cannot be determined.
- [x] Tests cover AFK/HITL filtering, dependency blocking, validation failure, active claim exclusion, expired claim behavior, JSON output, and porcelain output.

## Blocked by

- [[60354-canonical-task-model-show-and-prompt]]
- [[60355-simple-local-claim-lock]]
