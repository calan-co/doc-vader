---
id: wi-60363
title: Runtime Entity Schemas
summary: Define reusable schemas and validators for claim, lock, and execution log entry runtime entities.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: prioritized
priority: critical
estimated: 4
links:
  depends_on:
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
  reference:
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
tags:
  - afk
  - runtime
  - schema
  - claims
  - locks
---

## Goal

Define bounded runtime entity schemas for the local multi-agent execution model.

## Background

Claims and locks are generic runtime entities, not task-only concepts. Execution log rows should validate as `execution_log_entry` snapshots that can target task artifacts now and other artifact types later.

These schemas define canonical runtime records before the SQLite adapter persists them. The MVP uses SQLite as the local storage adapter, but schema and validation semantics remain independent of storage type and output format.

Architectural context: `docs/architecture/decisions/adr-009-storage-and-format-seams.md`.

## Tasks

- [ ] Define a `claim` schema for live execution lease/context records.
- [ ] Define a `lock` schema for live artifact mutex records.
- [ ] Define an `execution_log_entry` schema for append-only execution summary entries.
- [ ] Require `schema_version` inside every runtime payload.
- [ ] Define execution states: `running`, `completed`, `halted`, and `failed`.
- [ ] Define the state/reason compatibility matrix: `running/started`, `completed/success`, `failed/error`, and `halted` with `conflict`, `blocked`, `invalid`, `expired`, `revoked`, or `cancelled`.
- [ ] Define source-style `detail.code` values with `x-*` extension support where intended.
- [ ] Model claim targets generically with `target_type` and `target_id` while supporting `task` MVP values.
- [ ] Model lock identity as normalized repo-relative file path plus stable SHA-256 key.
- [ ] Add TypeScript validators and representative fixtures.

## Deliverables

- JSON Schema or TypeBox definitions for `claim`, `lock`, and `execution_log_entry`.
- Runtime validation helpers.
- Valid and invalid fixtures.

## Acceptance criteria

- [ ] Runtime entity schemas are generic enough for non-task artifacts later.
- [ ] Known states, reasons, reason compatibility, and detail codes are bounded for deterministic automation.
- [ ] `x-*` extensions are allowed only where explicitly intended.
- [ ] Validators are used by the SQLite store before durable writes.
- [ ] Tests cover valid snapshots, invalid enum values, missing schema versions, and extension codes.

## Blocked by

- [[60361-git-sqlite-local-multi-agent-runtime-contract]]
