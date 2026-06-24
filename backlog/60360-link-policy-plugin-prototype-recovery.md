---
id: wi-60360
title: Link Policy Plugin Prototype Recovery
summary: Review the abandoned link-policy remark plugin prototype from sandcastle/issue-60293 and either port the still-valid diagnostics or document why the prototype should be discarded.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: low
estimated: 2
links:
  reference:
    - '[[175.1.1.link-policy-plugin-task]]'
tags:
  - recovery
  - link-policy
  - remark
---

## Parent

[doc-vader Context Coordination PRD](../docs/how-to/implementation-plans/doc-vader-context-coordination-prd.md)

## Goal

Recover any still-useful link-policy validation behavior from the abandoned `sandcastle/issue-60293` worktree without merging stale code directly into `sandcastle-root`.

## Background

The stale worktree contains uncommitted changes for a remark link-policy plugin that are not present in `sandcastle-root`:

- `.remarkrc.mts`
- `lib/plugins/remark-lint-link-policy.ts`
- `lib/plugins/tests/remark-lint-link-policy.test.ts`
- `lib/processor.ts`
- `scripts/docs-remark-lint.ts`
- `tests/processor.test.ts`

The original branch is tied to archived work, so the implementation must be re-evaluated against the current lint pipeline before any code is recovered.

## Tasks

- [ ] Inspect the abandoned `sandcastle/issue-60293` diff and identify diagnostics or plugin behavior that still fits the current remark pipeline.
- [ ] Port only the useful behavior into current modules using current plugin conventions.
- [ ] Avoid changing global remark configuration unless the recovered rule is intentionally enabled by current policy.
- [ ] Add or update focused tests for any recovered diagnostics.
- [ ] Remove any dependency on the stale worktree after the recovered work is committed.

## Deliverables

- A current-code implementation or a documented decision that the prototype is obsolete.
- Tests covering any recovered link-policy diagnostics.
- Evidence explaining which stale files were ported, rewritten, or discarded.

## Acceptance criteria

- [ ] No stale worktree files are copied blindly; every recovered change is reviewed against current code.
- [ ] Any recovered plugin behavior is wired through current remark configuration intentionally.
- [ ] The implementation passes `pnpm run typecheck` and relevant tests.
- [ ] If no code is recovered, the work item records a clear discard rationale.

## Blocked by

None - can start immediately.
