---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60418
title: Agent Baseline Escalation Policy
summary: Define when Codex should request escalation up front for repository baseline checks so sandbox-blocked pnpm, registry, Nx, and cache access do not waste a failed first run.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 3
links:
  evidence:
    - '[[record-20260702-034230-60418]]'
tags:
  - afk
  - agent-environment
  - validation
---

## Goal

Define the repository policy that tells agents to run baseline validation gates
in the environment they actually require, including escalated execution when
package-manager verification, networked registry checks, Nx process access, or
shared caches are expected.

## Background

Codex currently tries sandboxed baseline checks first, even when the command is
known to need registry or environment access before local validation can start.
For this repo, that causes a predictable failed attempt before `pnpm run
typecheck`, `pnpm run test`, `pnpm run docs:lint`, or backlog validation can
produce useful signal.

## Tasks

- [ ] Inventory the baseline commands that need escalation or prewarmed state.
- [ ] Document when agents should request `require_escalated` before the first
      run.
- [ ] Distinguish validation escalation from prohibited bypasses of safety
      constraints.
- [ ] Add guidance for reporting environment failures separately from code
      failures.

## Deliverables

- Updated agent/operator guidance for baseline validation execution.
- A concise command classification table for typecheck, tests, docs lint, and
  backlog validation.
- Notes explaining why escalation is required for package-manager and cache
  access, not for bypassing validation.

## Acceptance Criteria

- [ ] Baseline checks that require registry, pnpm verification, Nx, or cache
      access are classified as escalation-up-front commands.
- [ ] The guidance says agents should not first attempt known-blocked sandbox
      runs for those commands.
- [ ] The guidance preserves existing safety boundaries around branch
      protection, secrets, CI triggers, hooks, and permissions.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `pnpm run backlog:validate`.

## Relationships

- `enables`: `[[60419-prewarmed-validation-environment-bootstrap]]`
