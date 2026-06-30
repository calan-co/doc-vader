---
id: wi-60411
title: Sandcastle Work Inspection Surface
summary: Deliver dv4sandcastle view and prompt over canonical dv work inspection without ad hoc Markdown parsing.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 5
links:
  depends_on:
    - '[[60410-sandcastle-planning-list-surface]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-sandcastle-ready-work-cli-prd.md]]'
tags:
  - afk
  - sandcastle
  - command-surface
  - work-management
---

## Goal

Make Sandcastle inspection use `dv4sandcastle view` and `dv4sandcastle prompt`
as thin adapters over canonical `dv work` inspection output.

## Background

After planning selects a work item, Sandcastle needs stable context for the
implementation agent. That context must come from the same Work model used by
selection, including graph relationships, ScopeRef semantics, and canonical
prompt rendering. It must not reintroduce a separate Markdown parser.

## What to build

Provide Sandcastle-facing view and prompt commands that expose canonical work
item context and execution prompt text through the adapter surface. The commands
should preserve the distinction between work inspection, implementation prompt
rendering, and mutation authority.

## Tasks

- [ ] Add or update `dv4sandcastle view` for canonical work item inspection.
- [ ] Add or update `dv4sandcastle prompt` for implementation-agent prompt
      rendering.
- [ ] Back inspection with `dv work show` and prompt rendering with
      `dv work prompt`.
- [ ] Remove reliance on ad hoc Markdown parsing for Sandcastle inspection.
- [ ] Preserve graph relationship and ScopeRef context visible to agents.
- [ ] Keep inspection commands read-only.
- [ ] Add CLI or integration coverage for view and prompt output.

## Deliverables

- Sandcastle-compatible `dv4sandcastle view` behavior.
- Sandcastle-compatible `dv4sandcastle prompt` behavior.
- Tests proving inspection uses canonical Work context and does not mutate
  state.

## Acceptance Criteria

- [ ] `dv4sandcastle view` returns canonical work context for a selected item.
- [ ] `dv4sandcastle prompt` returns implementation-ready prompt content for a
      selected item.
- [ ] Both commands are backed by `dv work` inspection surfaces.
- [ ] No separate Markdown-only parser is required for Sandcastle inspection.
- [ ] Inspection output includes relevant dependency, relationship, and scope
      context.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `doc-vader backlog validate --dir backlog --fail-on error`.

## Blocked by

- [[60410-sandcastle-planning-list-surface]]

## Relationships

- `depends_on`: `[[60410-sandcastle-planning-list-surface]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-sandcastle-ready-work-cli-prd.md]]`
