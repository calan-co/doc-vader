---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60419
title: Prewarmed Validation Environment Bootstrap
summary: Build a reproducible bootstrap path that verifies and caches the pinned pnpm toolchain, installs dependencies, and prepares Nx/Vitest state before agents run baseline checks.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 5
links:
  depends_on:
    - '[[60418-agent-baseline-escalation-policy]]'
tags:
  - afk
  - agent-environment
  - validation
---

## Goal

Create an out-of-the-box setup path that prewarms the validation environment so
Codex and other agents can run the normal baseline gates without waiting for a
doomed sandboxed package-manager bootstrap.

## Background

The repo pins `pnpm@11.7.0`. In a cold restricted agent environment, pnpm can
attempt registry signature verification before it runs local scripts. That
verification needs network-capable execution and should happen once during
environment bootstrap, not during every first validation attempt.

## Tasks

- [ ] Define the bootstrap command sequence for a fresh checkout.
- [ ] Ensure the pinned pnpm version and lockfile supply-chain verification are
      completed and cached.
- [ ] Prepare dependency, Nx, TypeScript, and Vitest caches used by the baseline
      gates.
- [ ] Document cache locations and environment variables that must be readable
      or writable by agent runs.
- [ ] Make the bootstrap idempotent so repeated runs are fast and safe.

## Deliverables

- A documented or scripted prewarm flow for agent environments.
- Clear requirements for network access, package-manager verification, cache
  directories, and temp directories.
- A local verification recipe proving that baseline commands start directly
  from useful validation work.

## Acceptance Criteria

- [ ] A fresh agent checkout can run the bootstrap once and then run baseline
      checks without a failed package-manager verification attempt.
- [ ] `pnpm run typecheck` starts TypeScript validation without requiring a
      preceding failed sandbox run.
- [ ] `pnpm run test` starts Nx/Vitest validation without requiring a preceding
      failed sandbox run.
- [ ] Documentation identifies which parts require network-capable escalation
      and which parts should remain sandboxed.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `pnpm run backlog:validate`.

## Relationships

- `depends_on`: `[[60418-agent-baseline-escalation-policy]]`
- `enables`: `[[60420-cold-start-baseline-validation-harness]]`
