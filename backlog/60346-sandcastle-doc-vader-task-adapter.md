---
id: wi-60346
title: Sandcastle Doc Vader Task Adapter
summary: Wire Sandcastle-facing prompts and adapter guidance to the `dv task` command surface so Sandcastle can select, claim, execute, record, and close AFK work without inline scripts.
type: work-item
subtype: story
lifecycle: active
status: paused
status_reason: blocked
priority: medium
estimated: 5
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/61
    - https://github.com/calan-co/doc-vader/pull/62
  depends_on:
    - '[[60341-task-ready-afk-eligibility-query]]'
    - '[[60342-task-scope-reservation-and-lookup]]'
    - '[[60343-task-claim-store-and-lifecycle]]'
    - '[[60344-claim-bound-artifact-reservations]]'
    - '[[60345-claim-aware-record-and-close-commands]]'
  reference:
    - '[[60339-agent-command-surface-for-skills-and-sandcastle]]'
  evidence:
    - '[[record-20260614-164457-60346]]'
tags:
  - afk
  - sandcastle
  - command-surface
  - integration
---

## Goal

Make Sandcastle consume Doc-Vader's task command surface instead of repository-specific inline scripts.

## Background

The authoritative Sandcastle registry treats an issue tracker as a command-backed integration surface. Doc-Vader should fit that shape while preserving its stronger AFK guardrails: ready selection, explicit scope reservation, explicit claim, claim-bound artifact reservations, evidence recording, graph-aware planning, and safe close.

## Tasks

- [ ] Document the Sandcastle command mapping from registry operations to `dv task` and `dv record` commands.
- [ ] Provide tool installation and required environment guidance for Sandcastle initialization.
- [ ] Replace existing Sandcastle prompt snippets or local guidance that hand-edit backlog state with `dv` commands.
- [ ] Ensure the default Sandcastle selection path uses `dv task ready` and never selects HITL work.
- [ ] Ensure execution flow composes `reserve`, `claim`, record, close, and release commands explicitly.
- [ ] Add integration tests or fixtures that prove the command sequence works for a representative AFK task.

## Deliverables

- Sandcastle adapter or prompt wiring for Doc-Vader task commands.
- Installation and environment guidance compatible with Sandcastle's issue tracker registry.
- Integration coverage for the full AFK task lifecycle.

## Acceptance Criteria

- [ ] Sandcastle can discover AFK-ready Doc-Vader tasks through `dv task ready`.
- [ ] Sandcastle can reserve scope, claim a task, record evidence, close success, and release or revoke when needed through documented commands.
- [ ] Sandcastle guidance does not include inline scripts that bypass Doc-Vader validation or claim policy.
- [ ] HITL work remains excluded from the Sandcastle-ready path.
- [ ] Hosted SaaS and published GitHub App concerns remain referenced to [[60338-hosted-saas-github-app-architecture-adr]] rather than implemented here.

## Blocked By

[[60341-task-ready-afk-eligibility-query]], [[60342-task-scope-reservation-and-lookup]], [[60343-task-claim-store-and-lifecycle]], [[60344-claim-bound-artifact-reservations]], [[60345-claim-aware-record-and-close-commands]]
