---
id: wi-60396
title: Graph-Backed Work Show Relationship Sections
summary: Source dv work show and dv wi show relationship sections from graph projection while keeping body rendering unchanged.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: high
estimated: 4
links:
  depends_on:
    - '[[60393-read-only-work-graph-explorer-cli]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
tags:
  - afk
  - cli
  - graph
  - work-management
---

## Goal

Make Work show output use graph projection for relationship sections while
preserving the canonical Work Item document loader for body, checklist, and
prompt-oriented content.

## Background

The graph should own durable relationship facts such as `depends_on`,
`belongs_to`, `implements`, `locks`, and `records`. The Work Item Markdown
document still owns body rendering, task lists, acceptance criteria, and other
human-authored content. This slice joins those two surfaces without making the
graph authoritative for document content.

This work must not migrate `dv wi prompt`.

## What to build

Refactor `dv work show` and `dv wi show` so relationship sections are read from
the projected graph for the selected Work Item. Keep current body rendering and
document content behavior intact. Do not introduce canonical `blocks` or
generic `relates_to` relationships.

## Tasks

- [ ] Locate the current show command rendering path and its relationship
      sections.
- [ ] Add a graph query for relationship edges connected to the selected Work
      Item.
- [ ] Render `depends_on`, `belongs_to`, `implements`, `records`, and visible
      lock relationships where currently appropriate.
- [ ] Preserve body, task, acceptance criteria, and prompt-oriented content from
      the canonical Work Item document loader.
- [ ] Preserve existing text and JSON output contracts where possible.
- [ ] Add tests proving relationship sections come from graph edges.
- [ ] Add tests proving `blocks` and `relates_to` are not emitted as canonical
      relationship sections.

## Deliverables

- Graph-backed relationship sections for Work show commands.
- Compatibility coverage for existing show output.
- Tests proving graph relationships and body rendering stay separated.

## Acceptance Criteria

- [ ] `dv wi show <id>` renders document body content as it did before this
      change.
- [ ] Relationship sections are sourced from projected graph edges.
- [ ] `depends_on`, `belongs_to`, `implements`, `records`, and visible lock
      facts render from graph data when present.
- [ ] JSON output includes graph relationship facts if the command currently
      supports JSON relationship data.
- [ ] No canonical `blocks` or `relates_to` relationship is displayed.
- [ ] `dv wi prompt` behavior is unchanged.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60393-read-only-work-graph-explorer-cli]]

## Relationships

- `depends_on`: `[[60393-read-only-work-graph-explorer-cli]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]`
