---
id: wi-60407
title: Graph-Backed Work Prompt Relationship Context
summary: Move prompt relationship context to graph facts while preserving execution-oriented prompt rendering.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: high
estimated: 4
links:
  depends_on:
    - "[[60406-immutable-work-command-inventory-and-parity-harness]]"
    - "[[60396-graph-backed-work-show-relationships]]"
  reference:
    - "[[../docs/how-to/implementation-plans/doc-vader-immutable-command-graph-migration-prd.md]]"
tags:
  - afk
  - cli
  - graph
  - work-management
---

## Goal

Make `dv work prompt`, `dv wi prompt`, and compatibility aliases use graph
facts for relationship context while preserving the canonical Work Item body and
execution instructions.

## Background

`show` already renders relationship sections from projected graph edges while
leaving body rendering unchanged. Prompt output is still execution-oriented and
must keep canonical document content, but its relationship context should not
preserve stale body-only relationship sections after the read model has moved to
the graph.

This work must not change claim, execution, or lifecycle behavior.

## What to build

Refactor prompt model assembly so relationship context comes from formal graph
edges where prompt output includes relationship facts. Preserve task body,
acceptance criteria, execution instructions, and existing prompt template
behavior except for intentional relationship-context differences covered by
tests.

## Tasks

- [ ] Reuse the parity harness from `wi-60406`.
- [ ] Locate prompt model loading and rendering paths.
- [ ] Source governed relationship context from projected graph edges.
- [ ] Preserve canonical Work Item body sections and execution instructions.
- [ ] Ensure informational edges remain review or diagnostic metadata only.
- [ ] Add CLI parity coverage for `task`, `work`, and `wi` aliases.
- [ ] Add tests proving prompt execution does not mutate runtime, claims, locks,
      records, or documents.

## Deliverables

- Graph-backed prompt relationship context.
- Compatibility tests for prompt output and aliases.
- Read-only safety coverage for prompt execution.

## Acceptance Criteria

- [ ] Prompt relationship context uses projected formal graph facts where
      relationship facts are rendered.
- [ ] Prompt body content, tasks, acceptance criteria, and execution
      instructions remain canonical-document backed.
- [ ] Informational `references` edges do not become execution blockers or
      governed prompt relationships.
- [ ] Existing prompt output remains stable except for documented,
      test-covered relationship-context changes.
- [ ] `task`, `work`, and `wi` aliases remain aligned.
- [ ] No mutation or runtime claim behavior is introduced.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `doc-vader backlog validate --dir backlog --fail-on error`.

## Blocked by

- [[60406-immutable-work-command-inventory-and-parity-harness]]
- [[60396-graph-backed-work-show-relationships]]

## Relationships

- `depends_on`: `[[60406-immutable-work-command-inventory-and-parity-harness]]`
- `depends_on`: `[[60396-graph-backed-work-show-relationships]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-immutable-command-graph-migration-prd.md]]`
