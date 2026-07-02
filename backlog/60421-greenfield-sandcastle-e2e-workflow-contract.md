---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60421
title: Greenfield Sandcastle E2E Workflow Contract
summary: Establish the supported greenfield workflow from sandcastle init through dv-backed implementation while keeping Sandcastle as an ancillary enablement stack.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 4
links:
  depends_on:
    - '[[60414-sandcastle-init-templateargs-wiring]]'
    - '[[60415-authoritative-dv4sandcastle-documentation]]'
    - '[[60416-end-to-end-sandcastle-smoke-and-recovery]]'
tags:
  - afk
  - sandcastle
  - integration
  - work-management
---

## Goal

Define the complete greenfield Sandcastle workflow Doc-Vader supports, starting
with `sandcastle init` and ending with a dv-backed implementation run that uses
the `dv4sandcastle` command contract, even when this repository keeps a
committed `.sandcastle` directory for operator convenience.

## Background

The existing adapter work proves the command surfaces and generated scaffold
behavior inside this repository. It does not yet establish the external,
greenfield operator contract: how a fresh consumer initializes Sandcastle, how
the generated workflow points at Doc-Vader, which convenience scaffold files may
live in the Doc-Vader repo, and which boundaries Doc-Vader does and does not
own.

## Tasks

- [ ] Define the supported `sandcastle init` inputs for a Doc-Vader-backed
      workflow.
- [ ] Document the generated command expectations for planning, inspection,
      claim, prompt, recovery, and terminal handling.
- [ ] Specify the temporary workspace fixture state needed for a real
      implementation run.
- [ ] Define how committed convenience `.sandcastle` files are treated during
      validation.
- [ ] State that Sandcastle is ancillary enablement, not a coupled Doc-Vader
      capability.
- [ ] Identify which assertions belong in Doc-Vader contract tests versus
      Sandcastle-owned tests.

## Deliverables

- Greenfield Sandcastle workflow contract.
- Boundary statement for Doc-Vader, `dv4sandcastle`, and Sandcastle ownership.
- Policy for committed convenience `.sandcastle` files versus generated
  validation artifacts.
- Temporary workspace fixture requirements for a full init-to-implementation
  validation run.

## Acceptance Criteria

- [ ] The contract permits this repository to include `.sandcastle` files for
      convenience.
- [ ] The readiness proof starts from a temporary workspace fixture where
      `.sandcastle` is absent before `sandcastle init` runs.
- [ ] The contract names `sandcastle init` as the scaffold creation step.
- [ ] The only implied relationship between Doc-Vader and Sandcastle is the
      `dv4sandcastle` CLI expectation.
- [ ] The contract covers planning, inspection, claim, prompt, recovery, and
      implementation handoff.
- [ ] Sandcastle-specific behavior is assigned to Sandcastle, not Doc-Vader.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `pnpm run backlog:validate`.

## Relationships

- `depends_on`: `[[60414-sandcastle-init-templateargs-wiring]]`
- `depends_on`: `[[60415-authoritative-dv4sandcastle-documentation]]`
- `depends_on`: `[[60416-end-to-end-sandcastle-smoke-and-recovery]]`
- `enables`: `[[60422-greenfield-sandcastle-init-to-implementation-harness]]`
