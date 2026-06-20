---
id: wi-60357
title: Claim Aware Task Record Payload
summary: Implement `dv task record --claim --payload` so Sandcastle can create and link evidence through one validated command without hand-editing backlog state.
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: critical
estimated: 6
actual: 6
completed_date: '2026-06-18'
links:
  depends_on:
    - '[[60354-canonical-task-model-show-and-prompt]]'
    - '[[60355-simple-local-claim-lock]]'
  reference:
    - '[[60345-claim-aware-record-and-close-commands]]'
  evidence:
    - '[[record-20260616-043441-60357]]'
tags:
  - afk
  - sandcastle
  - dogfood
  - command-surface
  - records
---

## Parent

[Sandcastle Dogfood Command Surface PRD](../docs/how-to/implementation-plans/sandcastle-dogfood-command-surface-prd.md)

## What to build

Add claim-aware evidence recording for the Sandcastle dogfood loop. `dv task record --claim <claim-id> --payload <json-file|-> --json` should validate a structured record payload, derive the task from the active claim, create the record artifact, link it back to the work item, and fail before writes when input or claim state is invalid.

## Acceptance criteria

- [x] `dv task record --claim <claim-id> --payload <json-file> --json` validates payload input and creates linked task evidence for an active claim.
- [x] `dv task record --claim <claim-id> --payload - --json` supports stdin JSON for Sandcastle integration.
- [x] Payload validation covers type, summary, observation, outcome, artifact refs, supporting refs, findings, and notes.
- [x] Invalid payloads, missing claims, expired claims, and task mismatches fail before durable writes.
- [x] Record creation and work-item evidence linking are performed through one command without hand-editing backlog files.
- [x] Existing `record create` behavior remains compatible, with task-specific linkage owned by `dv task record`.
- [x] Tests cover file payload, stdin payload, invalid payload, claim failure, record creation, evidence linking, and validation gate behavior.

## Blocked by

- [[60354-canonical-task-model-show-and-prompt]]
- [[60355-simple-local-claim-lock]]
