---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60420
title: Cold-Start Baseline Validation Harness
summary: Add a repeatable proof harness that simulates a cold agent session and verifies the prewarmed environment runs baseline checks without sandbox-bootstrap failures.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: medium
estimated: 4
links:
  depends_on:
    - '[[60419-prewarmed-validation-environment-bootstrap]]'
tags:
  - afk
  - agent-environment
  - validation
---

## Goal

Prove that the escalated, prewarmed environment works from a cold agent session
by running the same baseline checks agents rely on and capturing whether any
failure is environmental or code-related.

## Background

The intended outcome is not just faster local checks. The repo needs a durable
signal that an agent can start from a fresh checkout, perform the approved
prewarm path, and then run the baseline validation matrix without first
encountering the known pnpm registry/signature sandbox failure.

## Tasks

- [ ] Define the cold-start fixture or script boundary.
- [ ] Run the prewarm bootstrap in a clean environment.
- [ ] Run `pnpm run typecheck`, `pnpm run test`, `pnpm run docs:lint`, and
      backlog validation after prewarm.
- [ ] Capture timings and classify failures as environment, validation, or
      product defects.
- [ ] Document the expected output and troubleshooting path.

## Deliverables

- A cold-start validation harness or documented reproducible procedure.
- Evidence format for recording command durations and failure classes.
- Troubleshooting guidance for pnpm verification, Nx access, and cache
  permissions.

## Acceptance Criteria

- [ ] The harness proves that prewarmed baseline checks do not require an
      initial failed sandbox run.
- [ ] The harness records command duration and final exit status for each
      baseline gate.
- [ ] The harness distinguishes environment bootstrap failures from code
      validation failures.
- [ ] The harness can be run by Codex without modifying branch protection,
      secrets, CI triggers, hooks, or file permissions.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `pnpm run backlog:validate`.

## Relationships

- `depends_on`: `[[60419-prewarmed-validation-environment-bootstrap]]`
