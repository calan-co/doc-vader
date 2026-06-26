---
id: wi-60394
title: Work Graph UAC Review Fixtures
summary: Create repeatable UAC fixtures and review commands for validating Work graph nodes, edges, and DOT output.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
completed_date: '2026-06-26'
priority: medium
estimated: 3
links:
  depends_on:
    - '[[60393-read-only-work-graph-explorer-cli]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
tags:
  - afk
  - uac
  - graph
  - work-management
---

## Goal

Give reviewers a repeatable way to validate the Work graph explorer against the
MVP user acceptance criteria without manually editing repository files or
reverse-engineering command behavior.

## Background

The Work graph MVP needs human review of relationship semantics, not only unit
tests. The review path should demonstrate canonical edges such as `depends_on`,
`belongs_to`, `implements`, `locks`, and `records`, while also confirming that
transient blocker state is not modeled as a canonical `blocks` edge and generic
`relates_to` is not introduced prematurely.

## What to build

Add review fixtures, expected output snapshots, or documented command recipes
that exercise the graph explorer over a small, stable graph. The fixtures must
cover JSON inspection and DOT rendering paths and must remain read-only during
review. The review path must exercise the context-graph-compatible output
extension seam so UAC validates the future migration boundary, not only the CLI
surface.

## Tasks

- [x] Identify the appropriate fixture location for Work graph UAC review data.
- [x] Create or reuse a small Work graph fixture with WorkItem, Claim, Record,
      and Scope nodes.
- [x] Include examples for `depends_on`, `belongs_to`, `implements`, `locks`,
      and `records` edges.
- [x] Include an explicit absence check for canonical `blocks` and
      `relates_to` edges.
- [x] Add documented commands for JSON node, JSON edge, inspect, and DOT output
      review.
- [x] Ensure JSON and DOT fixture expectations are generated through the graph
      output extension seam.
- [x] Add automated tests or snapshots that keep fixture expectations stable.
- [x] Ensure fixture review commands do not mutate repository or runtime state.

## Deliverables

- Work graph UAC review fixture or fixture-backed command recipe.
- Expected graph facts for JSON and DOT review.
- Fixture coverage for the context-graph-compatible output extension seam.
- Automated coverage or snapshots for the review path.

## Acceptance Criteria

- [x] A reviewer can run documented commands and confirm the projected node set.
- [x] A reviewer can run documented commands and confirm the projected edge set.
- [x] JSON review covers `depends_on`, `belongs_to`, `implements`, `locks`, and
      `records`.
- [x] DOT review produces renderable directed graph output.
- [x] JSON and DOT review fixtures exercise the output extension seam rather
      than bypassing it with test-only formatters.
- [x] The fixture or tests prove `blocks` and `relates_to` are not canonical
      authored relationship edges.
- [x] Review commands are read-only.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60393-read-only-work-graph-explorer-cli]]

## Relationships

- `depends_on`: `[[60393-read-only-work-graph-explorer-cli]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]`
