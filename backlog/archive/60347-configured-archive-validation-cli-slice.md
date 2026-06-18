---
id: wi-60347
title: Configured Archive Validation CLI Slice
summary: Add a deterministic archive validation command path that honors configured archive roots, declared schemas, and legacy fallback schema policy.
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 5
actual: 2
completed_date: '2026-06-16'
links:
  reference:
    - '[[60339-agent-command-surface-for-skills-and-sandcastle]]'
  evidence:
    - '[[record-20260616-043441-60347]]'
tags:
  - archive
  - validation
  - command-surface
  - afk
---

## Parent

[doc-vader Context Coordination PRD](../docs/how-to/implementation-plans/doc-vader-context-coordination-prd.md)

## What to build

Add deterministic archive validation reachable from a CLI path so archived work-item validation can be run as a complete vertical slice. The interface may be incorporated into an existing lint or backlog validation command, or exposed as a task command, but it must provide stable command behavior for automation.

The command path must resolve archive roots from `.doc-vader/backlog-consumer.json`, validate archived files against their declared `$schema` when present, apply configured legacy fallback schema behavior when `$schema` is missing, and avoid writing validation provenance fields such as `validated_at` or `validated_by` into archived frontmatter.

## Acceptance criteria

- [ ] A deterministic CLI invocation validates archived work items and reports machine-usable results.
- [ ] Archive roots are resolved from `.doc-vader/backlog-consumer.json` rather than hard-coded to `backlog/archive`.
- [ ] Archived files with declared `$schema` values are validated against those schema declarations.
- [ ] Schema resolution from `$schema` values is constrained to repo-local or explicitly allowlisted schemas and never resolves arbitrary external schemas.
- [ ] Legacy archived files without `$schema` use a configurable fallback schema and missing-schema severity.
- [ ] The command fails explicitly with a clear error when `.doc-vader/backlog-consumer.json` is missing or malformed rather than silently falling back or validating the wrong roots.
- [ ] Validation does not add `validated_at`, `validated_by`, or equivalent provenance fields to archived work items.
- [ ] Tests cover configured archive roots, declared schemas, fallback schemas, missing-schema severity, and CLI output.

## Blocked by

None - can start immediately.
