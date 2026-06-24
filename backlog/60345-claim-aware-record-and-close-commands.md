---
id: wi-60345
title: Claim Aware Record and Completion Commands
summary: Implement generic record creation plus task-scoped record and claim completion commands that require active claims, evidence-safe writes, validation gates, and automatic runtime cleanup.
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: medium
estimated: 6
actual: 6
completed_date: '2026-06-23'
links:
  depends_on:
    - '[[60343-task-claim-store-and-lifecycle]]'
    - '[[60374-lock-command-surface]]'
    - '[[60375-lock-path-normalization-and-rename-gate]]'
  reference:
    - '[[60339-agent-command-surface-for-skills-and-sandcastle]]'
    - '[[60376-runtime-extension-authoring-process]]'
  evidence:
    - '[[record-20260614-164457-60345]]'
tags:
  - afk
  - sandcastle
  - command-surface
  - records
---

## Goal

Add claim-aware record and completion commands so agents can record evidence and complete tasks without hand-editing backlog files.

## Background

Doc-Vader core should treat records as generic configured artifacts. `dv record create` creates a top-level record resource, while `dv task record` is a claim-aware shorthand for creating and linking a record inside task execution. `dv claim complete` derives the task from the claim, runs required gates, performs durable writes, appends `completed/success`, and removes claim-owned runtime rows only after success.

## Tasks

- [x] Implement `dv record create --type <record-type> --payload <json-or-file> [--dry-run] [--json|--porcelain]`.
- [x] Implement `dv task record --claim <claim-id> --type <record-type> --payload <json-or-file> [--dry-run] [--json|--porcelain]`.
- [x] Normalize inline and file-backed payloads through one payload parser and validator.
- [x] Ensure every file mutated during record creation or linkage is covered by the active claim's locks.
- [x] Implement completion through `dv claim complete <claim-token> [--dry-run] [--json|--porcelain]`.
- [x] Run required validation gates before durable completion writes and cleanup only after successful completion.
- [x] Cover record creation, task linkage, completion success, completion gate failure, automatic cleanup, dry-run, and payload validation in tests.

## Deliverables

- Generic record creation command.
- Claim-aware task record shorthand.
- Safe claim completion command with validation gates and automatic runtime cleanup.
- Tests for record, linkage, completion, and failure behavior.

## Acceptance Criteria

- [x] Generic records can be created through `dv record create` without task-specific behavior in Doc-Vader core.
- [x] `dv task record` creates and links a record only inside an active claim context.
- [x] Record payloads can be supplied with `--payload` and validate before writes.
- [x] `dv claim complete <claim-token>` does not require a separate task ID argument.
- [x] Completion fails before durable writes when required gates fail.
- [x] Successful completion removes active claim-owned runtime rows after durable writes and validation pass.
- [x] Evidence and completion operations cannot mutate files outside the active claim's lock set.

## Dependencies

[[60343-task-claim-store-and-lifecycle]], [[60374-lock-command-surface]], [[60375-lock-path-normalization-and-rename-gate]]
