---
id: wi-60358
title: Sandcastle Dogfood Adapter Flow
summary: Document and test the minimal Sandcastle sequence over `dv task` commands so one local agent can safely dogfood Doc-Vader improvements.
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: critical
estimated: 5
actual: 5
completed_date: '2026-06-18'
links:
  depends_on:
    - '[[60356-fail-closed-ready-selection-cli]]'
    - '[[60357-claim-aware-task-record-payload]]'
  reference:
    - '[[60346-sandcastle-doc-vader-task-adapter]]'
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
    - '[[60370-sandcastle-local-multi-agent-flow]]'
  evidence:
    - '[[record-20260616-043441-60358]]'
tags:
  - afk
  - sandcastle
  - dogfood
  - command-surface
  - integration
---

## Parent

[Sandcastle Dogfood Command Surface PRD](../docs/how-to/implementation-plans/sandcastle-dogfood-command-surface-prd.md)

## What to build

Lock in the minimal Sandcastle dogfood flow over Doc-Vader commands: ready selection, claim, show/prompt context, implementation, validation, evidence recording, and release. The flow should explicitly stop before automatic close/finalize until the broader close gate is implemented.

The successor multi-agent dogfood flow is tracked in [[60370-sandcastle-local-multi-agent-flow]] on top of [[60361-git-sqlite-local-multi-agent-runtime-contract]].

## Acceptance criteria

- [x] Sandcastle-facing guidance maps selection, inspection, claim, evidence, and release to concrete `dv task` commands.
- [x] The default flow uses `dv task ready --json` and cannot select HITL work.
- [x] The default flow claims before implementation and releases on success, stop, or failure.
- [x] The default flow records evidence through `dv task record --claim --payload`.
- [x] The flow explicitly stops before automatic close/finalize and hands off validation/evidence state to a human or follow-on agent.
- [x] An integration fixture or scripted test proves a representative task can move through ready, claim, show, prompt, record, validate, and release without hand-edited backlog state.
- [x] Documentation names the deferred production features: scope graphs, artifact reservations, hosted authority, revocation, and auto-close.

## Blocked by

- [[60356-fail-closed-ready-selection-cli]]
- [[60357-claim-aware-task-record-payload]]
