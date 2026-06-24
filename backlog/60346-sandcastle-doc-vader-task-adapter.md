---
id: wi-60346
title: Sandcastle Doc Vader Task Adapter
summary: Wire Sandcastle-facing prompts and adapter guidance to the `dv task` command surface so Sandcastle can select, claim, execute, record, and close AFK work without inline scripts.
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: medium
estimated: 5
actual: 5
completed_date: '2026-06-23'
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/61
    - https://github.com/calan-co/doc-vader/pull/62
  depends_on:
    - '[[60341-task-ready-afk-eligibility-query]]'
    - '[[60373-claim-command-surface]]'
    - '[[60374-lock-command-surface]]'
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

The authoritative Sandcastle registry treats an issue tracker as a command-backed integration surface. Doc-Vader should fit that shape while preserving its stronger AFK guardrails: ready selection, explicit claim, claim-owned file locks, evidence recording, dependency-aware planning metadata, and safe completion.

Hosted SaaS and published GitHub App concerns stay referenced in [[60338-hosted-saas-github-app-architecture-adr]] and are out of scope for this slice.

## Tasks

- [x] Document the Sandcastle command mapping from registry operations to `dv task` and `dv record` commands.
- [x] Provide tool installation and required environment guidance for Sandcastle initialization.
- [x] Replace existing Sandcastle prompt snippets or local guidance that hand-edit backlog state with `dv` commands.
- [x] Ensure the default Sandcastle selection path uses `dv task ready` and never selects HITL work.
- [x] Ensure execution flow composes ready selection, claim creation, lock acquisition, record creation, and claim completion commands explicitly.
- [x] Add integration tests or fixtures that prove the command sequence works for a representative AFK task.

## Deliverables

- [x] Sandcastle adapter or prompt wiring for Doc-Vader task commands.
- [x] Installation and environment guidance compatible with Sandcastle's issue tracker registry.
- [x] Integration coverage for the full AFK task lifecycle.

## Acceptance Criteria

- [x] Sandcastle can discover AFK-ready Doc-Vader tasks through `dv task ready`.
- [x] Sandcastle can claim a task, acquire locks, record evidence, complete success, and halt/recover when needed through documented commands.
- [x] Sandcastle guidance does not include inline scripts that bypass Doc-Vader validation or claim policy.
- [x] HITL work remains excluded from the Sandcastle-ready path.
- [x] Hosted SaaS and published GitHub App concerns remain referenced to [[60338-hosted-saas-github-app-architecture-adr]] rather than implemented here.

## Dependencies

[[60341-task-ready-afk-eligibility-query]], [[60373-claim-command-surface]], [[60374-lock-command-surface]], [[60345-claim-aware-record-and-close-commands]]
