---
$schema: /frontmatter/document
id: adrtaskw-3842
title: Keep Work Item canonical and Task as command projection
type: document
subtype: generic
status: ready
lifecycle: active
tags:
  - adr
  - architecture
  - work-management
  - task
links:
  reference:
    - '[[../../how-to/implementation-plans/sandcastle-dogfood-command-surface-prd.md]]'
    - '[[../../../backlog/60339-agent-command-surface-for-skills-and-sandcastle]]'
    - '[[../../../backlog/60377-work-item-governance-kernel]]'
---

## Context and Problem Statement

The repository uses `type: work-item` as the canonical backlog artifact model.
Sandcastle and agent workflows use a `dv task` command surface because workers
need concise verbs for ready selection, showing context, claiming, recording
evidence, halting, and recovery.

The architecture must prevent `task` from becoming a second canonical entity
model with duplicated lifecycle and readiness rules.

## Decision

Work Item remains the canonical repository entity.

Task is a command projection over Work Item plus runtime execution state. The
`dv task` surface is allowed to optimize consumer and agent workflows, but it
must not define independent lifecycle, dependency, evidence, or closure rules.

Task commands consume the Work Item Governance Kernel and runtime entity state.
Templates render task context; they do not decide eligibility, policy, claim
state, validation, or evidence linking.

## Decision Drivers

- Existing repository artifacts and schemas are work-item based.
- Agents and humans benefit from task-oriented command verbs.
- Duplicating lifecycle rules between `work-item` and `task` would create drift.
- The Sandcastle command surface should be an adapter, not a new source of
  authority.

## Consequences

Positive:

- No repository-wide rename or schema churn is needed.
- Task commands can remain ergonomic while preserving canonical work-management
  semantics.
- Shared kernel tests can cover CLI, lint, scan, and Sandcastle use cases.

Negative/Risks:

- Documentation must consistently explain that `task` is a projection.
- Existing paused work items that describe task reservations or scope hashes must
  be reconciled against the current runtime contract.

## Validation

- `lib/task/**` behavior is refactored toward adapters over the Work Item
  Governance Kernel.
- `dv task` help and docs describe task as a command surface over Work Item.
- No new lifecycle rule is introduced only in task command code.
