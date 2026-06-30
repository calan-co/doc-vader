---
id: wi-60413
title: Sandcastle Close And Transition Surface
summary: Deliver dv4sandcastle close through configurable repository transition scripts and dv runtime release semantics.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 6
links:
  depends_on:
    - '[[60412-sandcastle-claim-and-recovery-surface]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-sandcastle-ready-work-cli-prd.md]]'
tags:
  - afk
  - sandcastle
  - runtime
  - work-management
---

## Goal

Make Sandcastle completion use `dv4sandcastle close` over repository-configured
transition behavior, Doc-Vader evidence, and runtime release semantics.

## Background

Repository-specific state transitions and checkbox mutation should not require
core `dv` code changes. Checkboxes are a Markdown format concern, while
agent-native progress belongs in graph relationships, runtime records, claims,
locks, and transition-profile-compatible repository scripts.

## What to build

Provide a close or terminal adapter flow that invokes repository-configured
transition behavior, records evidence through Doc-Vader authority, validates
allowed state movement, and releases runtime ownership cleanly. The flow should
not hard-code repo-specific lifecycle commands into core `dv`.

## Tasks

- [ ] Add or update `dv4sandcastle close` terminal handling.
- [ ] Route repository-specific transition or checklist behavior through
      configurable scripts.
- [ ] Validate terminal movement against the repository transition profile or
      script contract.
- [ ] Preserve Doc-Vader evidence recording before terminal transition.
- [ ] Release runtime claims and locks through native runtime semantics.
- [ ] Ensure failed close attempts leave recoverable runtime state.
- [ ] Add integration coverage for success, script failure, and recovery paths.

## Deliverables

- Sandcastle-compatible close behavior.
- Configurable repository transition script contract.
- Tests proving close composes evidence, transition validation, release, and
  recovery.

## Acceptance Criteria

- [ ] `dv4sandcastle close` can complete a claimed work item through repository
      transition behavior.
- [ ] Repository transition behavior is configurable without core `dv` code
      changes.
- [ ] Evidence is recorded through Doc-Vader before terminal release.
- [ ] Runtime claims and locks are released through native runtime authority.
- [ ] Failed transition or release leaves state recoverable.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `doc-vader backlog validate --dir backlog --fail-on error`.

## Blocked by

- [[60412-sandcastle-claim-and-recovery-surface]]

## Relationships

- `depends_on`: `[[60412-sandcastle-claim-and-recovery-surface]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-sandcastle-ready-work-cli-prd.md]]`
