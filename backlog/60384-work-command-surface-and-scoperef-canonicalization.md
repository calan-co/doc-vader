---
id: wi-60384
title: Work Command Surface And ScopeRef Canonicalization
summary: Add the canonical Work command surface and normalize Work Item scope identifiers without leaking storage details.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 4
links:
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
    - '[[../docs/architecture/decisions/adr-006-task-command-surface-work-item-canonical-model.md]]'
tags:
  - afk
  - work-management
  - command-surface
  - scopes
completed_date: "2026-06-25"
---

## Goal

Make Work the canonical command family for Work Item operations while preserving
the existing `dv task` behavior as a compatibility projection, and establish the
initial URI-shaped ScopeRef format used by claims and graph projection.

## Background

`Task` is one subtype of the broader Work Item family, so family-level commands
should not keep presenting `task` as the canonical model. This slice combines
the CLI rename and the ScopeRef canonicalization because both need the same
entity-type vocabulary and short-form registration rules.

The initial canonical ScopeRef format is `<entity-type-specifier>:<stable-id>`.
Registered short forms are canonical, with long form as fallback when no
short-form specifier exists. For current Work Items, `wi-60343` canonicalizes to
`wi:60343`. Storage adapter details such as files, paths, or database rows must
not appear in the ScopeRef.

## What to build

Add `dv work` as the primary family command, `dv wi` as the shorthand command,
and keep `dv task` as a deprecated compatibility alias that preserves legacy
JSON output for one migration window. Introduce the long-form implementation
surface under `lib/work/**`, with existing `lib/task/**` behavior retained as
thin compatibility wrappers during migration. Add ScopeRef canonicalization for
Work Items using the registered short-form specifier.

## Tasks

- [ ] Add `dv work` as the primary Work Item family command surface.
- [ ] Add `dv wi` as the shorthand command surface for the same behavior.
- [ ] Keep `dv task` available as a deprecated compatibility alias for the
      current command set and JSON output shape.
- [ ] Introduce or move family-level implementation code under `lib/work/**`.
- [ ] Keep `lib/task/**` wrappers only where needed for the compatibility
      window.
- [ ] Register the Work Item short-form entity specifier as `wi`.
- [ ] Normalize Work Item ScopeRefs so `wi-60343` resolves to `wi:60343`.
- [ ] Add tests covering command aliases, compatibility output, and ScopeRef
      canonicalization.

## Deliverables

- Canonical `dv work` and `dv wi` command surfaces.
- Deprecated `dv task` compatibility alias.
- Work Item ScopeRef normalization helper and tests.
- Migration notes for `lib/task/**` compatibility wrappers.

## Acceptance Criteria

- [ ] `dv work` and `dv wi` expose the current family-level Work Item behavior.
- [ ] `dv task` still works for existing users and preserves legacy JSON output
      for this migration window.
- [ ] Family-level implementation modules use Work terminology rather than Task
      terminology, except for explicit compatibility wrappers.
- [ ] Work Item ScopeRefs use the canonical `wi:<stable-id>` shape.
- [ ] ScopeRefs do not include file paths, storage adapter names, or database
      record identifiers.
- [ ] Tests prove alias behavior and ScopeRef canonicalization.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `pnpm run backlog:validate`.

## Blocked by

None - can start immediately.

## Relationships

- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]`
