---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60423
title: Preserve Greenfield Sandcastle E2E Readiness
summary: Preserve the init-to-implementation Sandcastle workflow with explicit evidence, optional external gating, and drift detection for the dv4sandcastle contract.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: medium
estimated: 5
links:
  depends_on:
    - '[[60422-greenfield-sandcastle-init-to-implementation-harness]]'
  evidence:
    - '[[record-20260702-034230-60423]]'
tags:
  - afk
  - sandcastle
  - integration
  - validation
---

## Goal

Keep the greenfield Sandcastle workflow from silently regressing by preserving
evidence, contract checks, and an explicit decision about where the end-to-end
gate runs while allowing the repo to carry convenience `.sandcastle` files.

## Background

Sandcastle should not become a required Doc-Vader capability dependency.
However, once Doc-Vader claims Sandcastle readiness, the init-to-implementation
path needs durable evidence and drift detection. The preservation mechanism
should verify the `dv4sandcastle` contract while keeping heavyweight
Sandcastle-specific execution outside the core Doc-Vader test suite unless it
is intentionally invoked. Preservation must distinguish committed convenience
scaffold files from the clean generated scaffold produced inside the temporary
workspace used as readiness evidence.

## Tasks

- [ ] Decide whether the full Sandcastle e2e run is manual, scheduled,
      release-gated, or opt-in local validation.
- [ ] Add a lightweight contract drift check for `dv4sandcastle` command names,
      arguments, and output expectations.
- [ ] Store evidence from successful greenfield runs in a stable backlog record
      or audit artifact.
- [ ] Record the temporary workspace path, initialization command, and generated
      scaffold manifest for each successful readiness run.
- [ ] Document how to refresh the evidence after Sandcastle or Doc-Vader
      changes.
- [ ] Ensure core Doc-Vader baseline checks do not require Sandcastle
      installation or generated `.sandcastle` files.
- [ ] Record whether the repo's committed `.sandcastle` convenience files are
      in sync with the last proven greenfield scaffold.
- [ ] Add failure triage guidance for Sandcastle setup versus Doc-Vader
      adapter contract regressions.

## Deliverables

- Preservation policy for greenfield Sandcastle e2e readiness.
- Contract drift check or documented opt-in validation command.
- Sync policy for committed convenience `.sandcastle` files.
- Evidence refresh procedure for future Sandcastle and `dv4sandcastle` changes.

## Acceptance Criteria

- [ ] Doc-Vader has durable evidence for a successful greenfield
      init-to-implementation Sandcastle workflow.
- [ ] The full Sandcastle e2e gate is explicitly scoped as opt-in, scheduled,
      manual, or release-gated.
- [ ] Core typecheck, unit test, docs lint, and backlog validation gates do not
      require Sandcastle.
- [ ] Drift in `dv4sandcastle` command expectations is detectable before a
      release claims Sandcastle readiness.
- [ ] The evidence refresh path creates a temporary workspace and starts from
      `sandcastle init`, not from committed `.sandcastle` artifacts.
- [ ] Committed `.sandcastle` files may exist, but they are treated as
      convenience outputs, not as the source of truth for readiness.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `pnpm run backlog:validate`.

## Relationships

- `depends_on`: `[[60422-greenfield-sandcastle-init-to-implementation-harness]]`
