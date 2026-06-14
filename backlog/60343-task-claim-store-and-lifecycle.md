---
id: wi-60343
title: Task Claim Store and Lifecycle
summary: Implement explicit task claims over reserved scope hashes, including local runtime persistence, TTL renewal policy, status, release, and escalated revocation.
type: work-item
subtype: story
lifecycle: active
status: ready
priority: critical
estimated: 8
links:
  depends_on:
    - '[[60342-task-scope-reservation-and-lookup]]'
  reference:
    - '[[60339-agent-command-surface-for-skills-and-sandcastle]]'
    - '[[60338-hosted-saas-github-app-architecture-adr]]'
  evidence:
    - '[[record-20260614-164243-60343]]'
tags:
  - afk
  - sandcastle
  - command-surface
  - claims
---

## Goal

Add explicit claim lifecycle commands that prevent concurrent agents from executing the same task scope.

## Background

The claim is the runtime execution lease. It must be explicit before work begins, persist the full claim in the configured store, and bind to an immutable scope hash. Claim IDs are lookup identifiers, not authorization tokens. Actor and timestamp metadata must come from the local or hosted authority, not caller payload fields.

## Tasks

- [ ] Define the MVP claim record shape with claim ID, task ID, scope hash, status, expiry, last seen time, reservations, and authority-emitted audit metadata.
- [ ] Implement a local runtime claim store with a backend interface suitable for hosted replacement.
- [ ] Implement `dv task claim <task-id> --scope <scope-hash> [--dry-run] [--json|--porcelain]`.
- [ ] Implement `dv task status --claim <claim-id> [--json]`.
- [ ] Implement `dv task release --claim <claim-id> [--dry-run] [--json|--porcelain]`.
- [ ] Implement `dv task revoke --claim <claim-id> --reason <text> [--evidence <ref>] [--dry-run] [--json|--porcelain]` behind host-native escalation.
- [ ] Set default TTL from `SANDCASTLE_IDLE_TIMEOUT_SECONDS` plus grace and renew only on explicit claim-context mutation commands.
- [ ] Ensure read-only claim-context commands update `last_seen_at` without extending `expires_at`.
- [ ] Cover conflict, expiry, release, revoked, dry-run, authority metadata, and output-format behavior in tests.

## Deliverables

- Claim store abstraction with local runtime backend.
- Claim, status, release, and revocation CLI commands.
- TTL and renewal policy implementation.
- Tests for lifecycle transitions and concurrency conflicts.

## Acceptance Criteria

- [ ] A task can be claimed only against an existing valid scope hash.
- [ ] Concurrent claim attempts for the same execution scope fail deterministically with structured conflict data.
- [ ] Claim creation persists the full claim and prints the claim ID.
- [ ] Claim IDs are treated as lookup handles, not authorization secrets.
- [ ] Caller payloads cannot set actor or timestamp audit fields.
- [ ] Revocation requires the configured escalation path and has no non-escalated override.
- [ ] Claim-context mutation commands renew the claim within policy; read-only status does not extend expiry.

## Blocked By

[[60342-task-scope-reservation-and-lookup]]
