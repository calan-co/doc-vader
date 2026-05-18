---
title: Release Candidate Readiness
type: document
subtype: generic
id: releasec-2330
lifecycle: active
status: ready
tags:
  - release
  - rc
  - readiness
  - validation
links:
  reference:
    - '[[170.remark-lint-unified-adoption-epic.md]]'
    - '[[180.staging-script-consolidation-epic.md]]'
    - '[[210-canonical_schema_integration_epic.md]]'
    - '[[support-multi-frameworks.md]]'
    - '[[233.release-candidate-readiness-criteria-task.md]]'
---

## Purpose

This checklist defines the branch-cut gate for the doc-vader release candidate.

## RC Scope Gate

All of the following must be true before creating an RC branch:

1. Epic 170 complete (all phases, including extended rules and CI integration).
2. Epic 180 complete (audit, migration, and deprecation/archive tracks).
3. Epic 210 complete (all phases and schema validation updates).
4. WI-52469 complete with deterministic reconciliation core behavior for RC.
5. WI-225, WI-226, and WI-227 complete.
6. Decomposition items WI-228 through WI-236 completed or explicitly re-scoped with documented rationale.

## Validation Gate

Run all checks below and require clean pass/fail output before branch cut:

1. `pnpm run docs:lint`
2. `pnpm run backlog:validate`
3. `pnpm run backlog:validate:ci`
4. targeted tests for completed slices
5. `pnpm run build`

## Backlog Integrity Gate

1. No hard schema errors in backlog work items.
2. No unresolved evidence references for active RC-scope work items.
3. No unresolved dependency links among RC-scope work items.
4. No manual close/archive actions outside approved workflows.

## Release Notes Gate

Before branch cut:

1. Update `CHANGELOG.md` with RC scope and notable behavior changes.
2. Add RC release notes including known limitations and deferred items.
3. Document WI-60275 as deferred with scope split from WI-52469.

## Stop Conditions

Do not cut RC branch when any of the following is true:

- Required checks fail.
- Required RC-scope work item is incomplete.
- A security, auth, or branch-protection constraint requires explicit escalation.
