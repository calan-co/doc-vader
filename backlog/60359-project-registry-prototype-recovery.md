---
id: wi-60359
title: Project Registry Prototype Recovery
summary: Review the abandoned project-registry prototype from sandcastle/issue-60291 and either port the still-valid registry and context-plugin behavior or document why it should be discarded.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: low
estimated: 3
links:
  reference:
    - '[[174.1.graph-and-naming-story]]'
  evidence:
    - '[[record-20260620-022741-60359]]'
tags:
  - recovery
  - registry
  - remark
---

## Parent

[doc-vader Context Coordination PRD](../docs/how-to/implementation-plans/doc-vader-context-coordination-prd.md)

## Goal

Recover any still-useful behavior from the abandoned `sandcastle/issue-60291` worktree without merging stale code directly into `sandcastle-root`.

## Background

The stale worktree contains uncommitted changes for a project registry and remark context integration that are not present in `sandcastle-root`:

- `lib/project-registry.ts`
- `lib/plugins/remark-project-context.ts`
- `lib/plugins/remark-lint-crossref.ts`
- `lib/plugins/tests/remark-lint-crossref.test.ts`
- `lib/processor.ts`
- `tests/project-registry.test.ts`

The original branch is tied to archived work, so the implementation must be re-evaluated against the current codebase instead of adopted wholesale.

## Tasks

- [ ] Inspect the abandoned `sandcastle/issue-60291` diff and identify behavior that is still compatible with current registry and remark plugin architecture.
- [ ] Port only the useful behavior into current modules using current repository patterns.
- [ ] Drop or document stale portions that conflict with current architecture.
- [ ] Add or update focused tests for any recovered behavior.
- [ ] Remove any dependency on the stale worktree after the recovered work is committed.

## Deliverables

- A current-code implementation or a documented decision that the prototype is obsolete.
- Tests covering any recovered project-registry or remark-context behavior.
- Evidence explaining which stale files were ported, rewritten, or discarded.

## Acceptance criteria

- [ ] No stale worktree files are copied blindly; every recovered change is reviewed against current code.
- [ ] Current tests cover recovered registry lookup, project context, or cross-reference behavior.
- [ ] The implementation passes `pnpm run typecheck` and relevant tests.
- [ ] If no code is recovered, the work item records a clear discard rationale.

## Blocked by

None - can start immediately.
