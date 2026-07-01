---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60422
title: Greenfield Sandcastle Init To Implementation Harness
summary: Validate a fresh sandcastle init workflow against Doc-Vader by running through planning, selection, claim, prompt, implementation, evidence, and terminal handling.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 8
links:
  depends_on:
    - '[[60421-greenfield-sandcastle-e2e-workflow-contract]]'
    - '[[60419-prewarmed-validation-environment-bootstrap]]'
tags:
  - afk
  - sandcastle
  - integration
  - testing
---

## Goal

Build a repeatable validation fixture that creates a temporary workspace, runs
greenfield `sandcastle init` inside that workspace, and proves a Doc-Vader-backed
Sandcastle workflow can reach a real implementation outcome through
`dv4sandcastle`, regardless of whether the source repo carries convenience
`.sandcastle` files.

## Background

Doc-Vader should be Sandcastle-ready in the sense that a separate Sandcastle
workflow can be initialized end to end and use Doc-Vader as the work authority.
That readiness must be proven without relying on pre-existing `.sandcastle`
files in Doc-Vader and without making Sandcastle behavior a Doc-Vader unit-test
dependency. The repo may still include `.sandcastle` artifacts for operator
convenience; the fixture must validate inside a temporary workspace as though
those artifacts are not present.

## Tasks

- [ ] Create an isolated temporary workspace fixture for the workflow.
- [ ] Populate the temporary workspace with only the Doc-Vader inputs required
      for the e2e run.
- [ ] Ensure the temporary workspace starts with no `.sandcastle` directory.
- [ ] Run `sandcastle init` with Doc-Vader-backed command configuration.
- [ ] Verify the generated workflow calls `dv4sandcastle` for list, view,
      prompt, claim, recover, and close or terminal guidance.
- [ ] Execute planning and select an AFK-safe fixture work item.
- [ ] Claim the selected work and render the implementation prompt.
- [ ] Perform a minimal implementation change and record evidence.
- [ ] Exercise terminal handling and recovery expectations for the workflow.
- [ ] Capture command output, exit codes, and workspace artifacts as evidence.

## Deliverables

- Greenfield init-to-implementation fixture or reproducible script.
- Temporary workspace fixture proving the workflow can complete against
  Doc-Vader authority.
- Isolation rule proving the harness does not consume committed convenience
  `.sandcastle` files.
- Evidence record format for the generated scaffold, selected work item, and
  implementation outcome.

## Acceptance Criteria

- [ ] The fixture creates a temporary workspace for each validation run.
- [ ] The temporary workspace begins with no `.sandcastle` directory.
- [ ] If the source checkout includes `.sandcastle`, the fixture does not copy
      it into the temporary workspace.
- [ ] `sandcastle init` creates the workflow scaffold during the run.
- [ ] Generated Sandcastle artifacts use `dv4sandcastle` rather than ad hoc
      backlog parsing or helper scripts.
- [ ] The workflow can plan, inspect, claim, prompt, implement, record
      evidence, and reach terminal handling.
- [ ] Failures are classified as Sandcastle setup, Doc-Vader contract,
      environment, or implementation failures.
- [ ] The harness does not require Sandcastle-dependent tests in Doc-Vader's
      core capability suite.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `pnpm run backlog:validate`.

## Relationships

- `depends_on`: `[[60421-greenfield-sandcastle-e2e-workflow-contract]]`
- `depends_on`: `[[60419-prewarmed-validation-environment-bootstrap]]`
- `enables`: `[[60423-preserve-greenfield-sandcastle-e2e-readiness]]`
