---
id: wi-60345
title: Claim Aware Record and Completion Commands
summary: Implement generic record creation plus task-scoped record and claim completion commands that require active claims, evidence-safe writes, validation gates, and automatic runtime cleanup.
type: work-item
subtype: story
lifecycle: active
status: paused
status_reason: blocked
priority: medium
estimated: 6
links:
  depends_on:
    - '[[60343-task-claim-store-and-lifecycle]]'
    - '[[60374-lock-command-surface]]'
    - '[[60375-lock-path-normalization-and-rename-gate]]'
  reference:
    - '[[60339-agent-command-surface-for-skills-and-sandcastle]]'
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

- [ ] Implement `dv record create --type <record-type> --payload <json-or-file> [--dry-run] [--json|--porcelain]`.
- [ ] Implement `dv task record --claim <claim-id> --type <record-type> --payload <json-or-file> [--dry-run] [--json|--porcelain]`.
- [ ] Normalize inline and file-backed payloads through one payload parser and validator.
- [ ] Ensure every file mutated during record creation or linkage is covered by the active claim's locks.
- [ ] Implement completion through `dv claim complete <claim-token> [--dry-run] [--json|--porcelain]`.
- [ ] Run required validation gates before durable completion writes and cleanup only after successful completion.
- [ ] Cover record creation, task linkage, completion success, completion gate failure, automatic cleanup, dry-run, and payload validation in tests.

## Deliverables

- Generic record creation command.
- Claim-aware task record shorthand.
- Safe claim completion command with validation gates and automatic runtime cleanup.
- Tests for record, linkage, completion, and failure behavior.

## Acceptance Criteria

- [ ] Generic records can be created through `dv record create` without task-specific behavior in Doc-Vader core.
- [ ] `dv task record` creates and links a record only inside an active claim context.
- [ ] Record payloads can be supplied with `--payload` and validate before writes.
- [ ] `dv claim complete <claim-token>` does not require a separate task ID argument.
- [ ] Completion fails before durable writes when required gates fail.
- [ ] Successful completion removes active claim-owned runtime rows after durable writes and validation pass.
- [ ] Evidence and completion operations cannot mutate files outside the active claim's lock set.

## Blocked By

[[60343-task-claim-store-and-lifecycle]], [[60374-lock-command-surface]], [[60375-lock-path-normalization-and-rename-gate]]
