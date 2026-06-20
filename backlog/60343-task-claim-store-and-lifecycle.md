---
id: wi-60343
title: Claim Store and Lifecycle
summary: Implement explicit task claims through the claim command surface, including local runtime persistence, TTL policy, status, terminal transitions, and cleanup.
type: work-item
subtype: story
lifecycle: active
status: paused
status_reason: blocked
priority: medium
estimated: 8
links:
  depends_on:
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
    - '[[60363-runtime-entity-schemas]]'
    - '[[60362-runtime-sqlite-store-and-migrations]]'
  reference:
    - '[[60339-agent-command-surface-for-skills-and-sandcastle]]'
    - '[[60338-hosted-saas-github-app-architecture-adr]]'
  evidence:
    - '[[record-20260614-164457-60343]]'
tags:
  - afk
  - sandcastle
  - command-surface
  - claims
---

## Goal

Add explicit claim lifecycle commands that prevent concurrent agents from executing the same Work Item target.

## Background

The claim is the runtime execution lease. It must be explicit before work begins and persist the full claim in the configured runtime store. The MVP claim target is generic (`target_type`, `target_id`) with task as the initial projection. Claim tokens are lookup identifiers, not authorization tokens. Actor and timestamp metadata must come from the local or hosted authority, not caller payload fields.

Architectural context: `docs/architecture/decisions/adr-007-local-runtime-authority-git-sqlite.md`.

## Tasks

- [ ] Define the MVP claim record shape with claim token, target, target type, expiry, generated state, and authority-emitted audit metadata.
- [ ] Implement a local runtime claim store with a backend interface suitable for hosted replacement.
- [ ] Implement `dv claim create --target task:<task-id> [--json|--porcelain]`.
- [ ] Keep `dv task claim <task-id>` as the task-facing convenience alias for claim creation.
- [ ] Implement `dv claim` and `dv claim status <claim-token>` for live claim status.
- [ ] Implement claim terminal transitions through `dv claim complete`, `dv claim fail`, and `dv claim halt`.
- [ ] Implement claim cleanup through `dv claim prune --filter <time-filter>` and `dv claim rm <claim-token>`.
- [ ] Set default TTL from `SANDCASTLE_IDLE_TIMEOUT_SECONDS` plus grace and renew only on explicit claim-context mutation commands.
- [ ] Ensure read-only claim-context commands update `last_seen_at` without extending `expires_at`.
- [ ] Cover conflict, expiry, terminal transition cleanup, revoked halt, dry-run, authority metadata, and output-format behavior in tests.

## Deliverables

- Claim store abstraction with local runtime backend.
- Claim status, transition, and cleanup CLI commands.
- TTL and renewal policy implementation.
- Tests for lifecycle transitions and concurrency conflicts.

## Acceptance Criteria

- [ ] A task can be claimed only when the target's latest execution-log entry is ready-permitting.
- [ ] Concurrent claim attempts for the same target fail deterministically with structured conflict data.
- [ ] Claim creation persists the full claim and prints the claim token.
- [ ] Claim tokens communicate ownership and execution correlation.
- [ ] Caller payloads cannot set actor or timestamp audit fields.
- [ ] Revocation is represented as `halted/revoked` through the claim halt path.
- [ ] Claim-context mutation commands renew the claim within policy; read-only status does not extend expiry.

## Blocked By

[[60361-git-sqlite-local-multi-agent-runtime-contract]], [[60363-runtime-entity-schemas]], [[60362-runtime-sqlite-store-and-migrations]]
