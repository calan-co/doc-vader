---
id: wi-60362
title: Runtime SQLite Store and Migrations
summary: Replace the local JSON claim store with a SQLite runtime backend for claims, locks, and execution log state.
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: critical
estimated: 5
actual: 5
completed_date: '2026-06-20'
links:
  depends_on:
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
    - '[[60363-runtime-entity-schemas]]'
  reference:
    - '[[60343-task-claim-store-and-lifecycle]]'
  evidence:
    - '[[task-record-preflight]]'
    - '[[record-sandcastle-task-validation-passed]]'
tags:
  - afk
  - runtime
  - sqlite
  - claims
  - locks
---

## Goal

Implement the local SQLite runtime store that provides transactional consistency for claims, locks, and execution log entries.

## Background

The current local claim store is JSON-backed and task-oriented. The multi-agent MVP needs one transactional local authority so claim creation, lock acquisition, and execution logging cannot drift across separate files.

Architectural context: `docs/architecture/decisions/adr-009-storage-and-format-seams.md`.

## Tasks

- [x] Add runtime store initialization under the configured `.doc-vader/runtime` path.
- [x] Add migrations for `claims`, `locks`, and `execution_log`.
- [x] Add `claims` columns for `claim_token`, target identity, holder, `expires_at`, timestamps, and metadata.
- [x] Enforce live-claim uniqueness on `claims(target_type, target_id)`.
- [x] Expose derived claim state `active|expired` from `expires_at` through a SQLite view or equivalent centralized query surface.
- [x] Add `locks` columns for `key`, `path`, `claim_token`, target identity, timestamps, and metadata.
- [x] Enforce table-level uniqueness for `locks.key` and `locks.path`.
- [x] Add `execution_log` columns for indexed `claim_token`, target identity, state, reason, created timestamp, and `payload`.
- [x] Store `execution_log.payload` as canonical JSON text and validate it in TypeScript before insert.
- [x] Add transaction helpers for multi-table runtime changes.
- [x] Keep the backend interface separable from the command layer for future hosted authority replacement.

## Deliverables

- SQLite runtime backend.
- Migration and initialization code.
- Runtime store interface used by task commands.
- Tests for initialization, uniqueness, transactions, and migration idempotency.

## Acceptance criteria

- [x] Runtime initialization creates all three tables deterministically.
- [x] `claims` has no public `execution_id` and no manually mutable persisted `state`.
- [x] Lock uniqueness is enforced by SQLite for both `key` and `path`.
- [x] Multi-table mutations can run in one transaction and roll back cleanly.
- [x] `execution_log.payload` rejects non-JSON or schema-invalid payloads before commit.
- [x] Existing task command tests can be migrated from JSON claim store assumptions without losing behavior.

## Blocked by

- [[60361-git-sqlite-local-multi-agent-runtime-contract]]
- [[60363-runtime-entity-schemas]]
