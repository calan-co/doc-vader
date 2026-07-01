---
id: wi-60415
title: Authoritative dv4sandcastle Documentation
summary: Document the current dv work and dv4sandcastle contract so agents stop relying on completed backlog history.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: medium
estimated: 4
completed_date: '2026-06-30'
links:
  depends_on:
    - '[[60414-sandcastle-init-templateargs-wiring]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-sandcastle-ready-work-cli-prd.md]]'
  evidence:
    - '[[task-record-preflight]]'
    - '[[task-record-preflight|2026-06-30: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.]]'
    - '[[record-wi-60415-dv4sandcastle-docs]]'
tags:
  - afk
  - sandcastle
  - docs
  - work-management
---

## Goal

Create or update authoritative documentation for the current `dv work` plus
`dv4sandcastle` contract so agents do not treat completed backlog history as
current guidance.

## Notes

- 2026-06-30: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.

## Background

Earlier completed work items describe the former `dv task` and JSON-claim-store
era. Those records are useful history, but they are not the source of truth for
new Sandcastle integration. The docs should describe the current command
surface, runtime authority, transition script boundary, and recovery model.

## What to build

Update durable documentation to explain how Sandcastle integrates with
Doc-Vader through `dv4sandcastle`, what remains authoritative in `dv work` and
runtime state, and which repository behaviors are configured through scripts.
The docs should supersede stale completed-backlog guidance without editing
historical completed items.

## Tasks

- [x] Identify the authoritative documentation home for the current
      Sandcastle adapter contract.
- [x] Document `dv work`, `dv wi`, and removed legacy `dv task` expectations.
- [x] Document the `dv4sandcastle` list, view, prompt, claim, recover, close,
      and release flow.
- [x] Document selectable versus horizon planning context.
- [x] Document repository-configured transition and checklist behavior.
- [x] Document partial-state recovery expectations.
- [x] Add cross-references from relevant Sandcastle or work-management docs.

## Deliverables

- Authoritative `dv4sandcastle` contract documentation.
- Updated references that steer agents away from stale completed backlog
  guidance.
- Documentation validation evidence.

## Acceptance Criteria

- [x] Current docs describe Sandcastle integration through `dv4sandcastle`.
- [x] Docs identify `dv work` as canonical and `dv wi` as shorthand.
- [x] Docs describe legacy `dv task` only as removed compatibility, not current
      command surface.
- [x] Docs explain repository-script transition behavior and recovery.
- [x] Completed backlog history is not edited or treated as authoritative
      current guidance.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `doc-vader backlog validate --dir backlog --fail-on error`.

## Blocked by

- [[60414-sandcastle-init-templateargs-wiring]]

## Relationships

- `depends_on`: `[[60414-sandcastle-init-templateargs-wiring]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-sandcastle-ready-work-cli-prd.md]]`
