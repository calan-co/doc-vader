---
id: wi-60414
title: Sandcastle Init TemplateArgs Wiring
summary: Regenerate Sandcastle prompt and tool wiring from InitService template arguments that call dv4sandcastle.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 5
links:
  depends_on:
    - '[[60410-sandcastle-planning-list-surface]]'
    - '[[60411-sandcastle-work-inspection-surface]]'
    - '[[60412-sandcastle-claim-and-recovery-surface]]'
    - '[[60413-sandcastle-close-and-transition-surface]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-sandcastle-ready-work-cli-prd.md]]'
tags:
  - afk
  - sandcastle
  - templates
  - work-management
---

## Goal

Make Sandcastle generated artifacts call the `dv4sandcastle` adapter surfaces
through InitService template arguments instead of hand-maintained prompt edits.

## Background

The generated Sandcastle prompts should be artifacts of the adapter contract.
If prompts and helper scripts are edited directly, they drift from the current
command surface and can quietly reintroduce ad hoc list, view, or close paths.

## What to build

Wire the local Sandcastle initialization path so template arguments provide the
adapter-backed list, view, prompt, close, and tool guidance commands. Regenerated
prompt artifacts should refer to the adapter contract and avoid direct lifecycle
edits or stale helper scripts.

## Tasks

- [ ] Update Sandcastle initialization data to provide `dv4sandcastle` command
      template arguments.
- [ ] Regenerate or update generated prompt artifacts from those template
      arguments.
- [ ] Replace stale ad hoc list, view, or close helper script references.
- [ ] Ensure plan prompts use the planning list surface.
- [ ] Ensure implementation prompts use inspection, claim, recovery, and close
      adapter guidance.
- [ ] Add tests or fixtures proving generated artifacts use the adapter
      contract.
- [ ] Keep prompt instructions aligned with repository-script transition
      behavior.

## Deliverables

- InitService template argument wiring for the Doc-Vader adapter.
- Generated Sandcastle prompt artifacts that call `dv4sandcastle`.
- Coverage proving prompt generation does not drift from the adapter contract.

## Acceptance Criteria

- [ ] Generated Sandcastle plan artifacts call the adapter-backed list surface.
- [ ] Generated Sandcastle implementation artifacts call adapter-backed view,
      prompt, claim, recover, and close guidance.
- [ ] Stale ad hoc helper-script references are removed from generated
      Sandcastle artifacts.
- [ ] Prompt artifacts are regenerated from template arguments, not maintained
      as separate command truth.
- [ ] Direct backlog state edits are not presented as the normal Sandcastle
      completion path.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `doc-vader backlog validate --dir backlog --fail-on error`.

## Blocked by

- [[60410-sandcastle-planning-list-surface]]
- [[60411-sandcastle-work-inspection-surface]]
- [[60412-sandcastle-claim-and-recovery-surface]]
- [[60413-sandcastle-close-and-transition-surface]]

## Relationships

- `depends_on`: `[[60410-sandcastle-planning-list-surface]]`
- `depends_on`: `[[60411-sandcastle-work-inspection-surface]]`
- `depends_on`: `[[60412-sandcastle-claim-and-recovery-surface]]`
- `depends_on`: `[[60413-sandcastle-close-and-transition-surface]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-sandcastle-ready-work-cli-prd.md]]`
