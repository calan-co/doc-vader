---
id: wi-60373
title: Claim Command Surface
summary: Implement the claim-scoped runtime command surface for claim creation, status, terminal transitions, and cleanup.
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: critical
estimated: 5
actual: 5
completed_date: '2026-06-21'
links:
  depends_on:
    - '[[60362-runtime-sqlite-store-and-migrations]]'
    - '[[60363-runtime-entity-schemas]]'
    - '[[60364-atomic-claim-and-lock-acquisition]]'
    - '[[60365-task-halt-command]]'
    - '[[60367-claim-prune-and-rm]]'
  reference:
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
    - '[[60376-runtime-extension-authoring-process]]'
  evidence:
    - '[[record-20260624-234349-60373]]'
tags:
  - afk
  - runtime
  - claims
  - command-surface
---

## Goal

Implement the claim command surface defined by the local multi-agent runtime contract.

## Background

The MVP uses `claim_token` as the public ownership and execution correlation handle. Claim commands expose bounded execution-attempt transitions instead of a generic state setter, and cleanup commands never mutate execution history. Claim commands mark claim execution state only; task Markdown progression remains a separate work-item lifecycle operation. The command surface depends on runtime entity schemas and storage adapter behavior, not on SQLite-specific details.

Architectural context: `docs/architecture/decisions/adr-009-storage-and-format-seams.md`.

## Tasks

- [x] Add `dv claim` as bulk status for all live claims.
- [x] Add `dv claim status <claim-token>` and `dv claim status --filter <time-filter>`.
- [x] Add `dv claim create --target task:<task-id>`.
- [x] Add `dv task claim <task-id>` as an alias for `dv claim create --target task:<task-id>`.
- [x] Add `dv claim complete <claim-token>` with implied execution state `completed/success`.
- [x] Add `dv claim fail <claim-token>` with implied execution state `failed/error`.
- [x] Ensure `dv claim halt` delegates to the halt implementation and supports only token mode plus `--filter <time-filter> --reason expired` bulk mode.
- [x] Ensure `dv claim prune` and `dv claim rm` delegate to cleanup implementation and never write execution-log entries.
- [x] Ensure claim terminal commands do not directly transition work-item Markdown status.
- [x] Enforce selector rules: bare mutating commands fail with help, and bulk mutating transitions are limited to expired-claim halt.
- [x] Implement MVP time filters: `until=now`, `until=24h`, `until=60m`, and `until=60s`.

## Deliverables

- Claim CLI commands.
- Shared selector and time-filter parser.
- Command tests for state transitions, cleanup delegation, and invalid selector usage.

## Acceptance criteria

- [x] Claim creation returns a `claim_token` and writes `running/started`.
- [x] Claim completion writes `completed/success` and removes claim-owned runtime rows.
- [x] Claim failure writes `failed/error` and removes claim-owned runtime rows.
- [x] Claim terminal commands leave task progression to the work-item lifecycle path.
- [x] Claim cleanup refuses active running claims.
- [x] Bare mutating claim commands return an error and help text.
- [x] Filtered bulk mutation is accepted only for `halt --reason expired`.

## Blocked by

- [[60362-runtime-sqlite-store-and-migrations]]
- [[60363-runtime-entity-schemas]]
- [[60364-atomic-claim-and-lock-acquisition]]
- [[60365-task-halt-command]]
- [[60367-claim-prune-and-rm]]
