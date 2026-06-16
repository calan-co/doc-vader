---
id: wi-60355
title: Simple Local Claim Lock
summary: Implement a conservative local claim lock so one Sandcastle dogfood agent can claim and release a task without waiting for the full scope graph architecture.
type: work-item
subtype: story
lifecycle: active
status: ready
status_reason: auto
priority: critical
estimated: 5
links:
  reference:
    - '[[60339-agent-command-surface-for-skills-and-sandcastle]]'
    - '[[60343-task-claim-store-and-lifecycle]]'
tags:
  - afk
  - sandcastle
  - dogfood
  - command-surface
  - claims
---

## Parent

[Sandcastle Dogfood Command Surface PRD](../docs/how-to/implementation-plans/sandcastle-dogfood-command-surface-prd.md)

## What to build

Add a minimal local claim lock for the Sandcastle dogfood MVP. The lock store should live in a gitignored Doc-Vader runtime location, be keyed by task id, include holder, branch or sandbox context, timestamps, and expiry, and provide deterministic conflict behavior when another active claim exists.

## Acceptance criteria

- [x] `dv task claim <task-id> --json` creates a local claim for an eligible task and returns a claim id plus non-sensitive metadata.
- [x] `dv task status --claim <claim-id> --json` reports active, expired, released, or missing claim state deterministically.
- [x] `dv task release --claim <claim-id> --json` releases an active local claim without mutating the work item.
- [x] Concurrent claim attempts for the same non-expired task claim fail closed with structured conflict data.
- [x] Expired claim behavior is deterministic and does not silently authorize unsafe work.
- [x] The MVP explicitly does not implement immutable scope graphs, artifact reservations, hosted authority, or escalated revocation.
- [x] Tests cover claim creation, conflict, release, expiry, missing claim, and machine-readable output.

## Blocked by

None - can start immediately.
