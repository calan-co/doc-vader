---
id: wi-60345
title: Claim Aware Record and Close Commands
summary: Implement generic record creation plus task-scoped record and close commands that require active claims, evidence-safe writes, validation gates, and automatic claim release.
type: work-item
subtype: story
lifecycle: active
status: ready
priority: high
estimated: 6
links:
  depends_on:
    - '[[60343-task-claim-store-and-lifecycle]]'
    - '[[60344-claim-bound-artifact-reservations]]'
  reference:
    - '[[60339-agent-command-surface-for-skills-and-sandcastle]]'
  evidence:
    - '[[record-20260614-164243-60345]]'
tags:
  - afk
  - sandcastle
  - command-surface
  - records
---

## Goal

Add claim-aware record and close commands so agents can record evidence and complete tasks without hand-editing backlog files.

## Background

Doc-Vader core should treat records as generic configured artifacts. `dv record create` creates a top-level record resource, while `dv task record` is a claim-aware shorthand for creating and linking a record inside task execution. `dv task close` derives the task from the claim, runs required gates, performs durable writes, and releases the claim only after success.

## Tasks

- [ ] Implement `dv record create --type <record-type> --payload <json-or-file> [--dry-run] [--json|--porcelain]`.
- [ ] Implement `dv task record --claim <claim-id> --type <record-type> --payload <json-or-file> [--dry-run] [--json|--porcelain]`.
- [ ] Normalize inline and file-backed payloads through one payload parser and validator.
- [ ] Ensure every artifact mutated during record creation or linkage is covered by the claim.
- [ ] Implement `dv task close --claim <claim-id> [--dry-run] [--json|--porcelain]`.
- [ ] Run required validation gates before durable close writes and release the claim only after successful close.
- [ ] Cover record creation, task linkage, close success, close gate failure, automatic release, dry-run, and payload validation in tests.

## Deliverables

- Generic record creation command.
- Claim-aware task record shorthand.
- Safe task close command with validation gates and automatic claim release.
- Tests for record, linkage, close, and failure behavior.

## Acceptance Criteria

- [ ] Generic records can be created through `dv record create` without task-specific behavior in Doc-Vader core.
- [ ] `dv task record` creates and links a record only inside an active claim context.
- [ ] Record payloads can be supplied with `--payload` and validate before writes.
- [ ] `dv task close --claim <claim-id>` does not require a separate task ID argument.
- [ ] Close fails before durable writes when required gates fail.
- [ ] Successful close releases the active claim after durable writes and validation pass.
- [ ] Evidence and close operations cannot mutate artifacts outside the claim's approved scope graph.

## Blocked By

[[60343-task-claim-store-and-lifecycle]], [[60344-claim-bound-artifact-reservations]]
