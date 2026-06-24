---
id: wi-60379
title: Reasoning-Level Execution Policy Spike
summary: Define whether reasoning-level classification should replace AFK/HITL tags as the future basis for unattended execution policy across Doc-Vader work execution.
type: work-item
subtype: spike
lifecycle: active
status: ready
status_reason: auto
priority: medium
estimated: 3
links:
  reference:
    - '[[60377-work-item-governance-kernel]]'
    - '[[../docs/architecture/decisions/adr-005-entity-governance-primitive-model.md]]'
    - '[[../docs/architecture/decisions/adr-008-work-item-governance-kernel.md]]'
tags:
  - hitl
  - spike
  - policy
  - sandcastle
  - work-management
---

## Goal

Decide whether Doc-Vader should move from operational `afk` and `hitl` tags
toward a canonical reasoning-level classification with policy and model-capability
thresholds for unattended execution.

## Background

Current Sandcastle and task selection behavior relies on `afk` and `hitl` tags.
That is operationally useful, but it conflates the nature of the work with the
current execution policy. A task that requires human judgment today may become
safe for unattended execution under a stronger model, accepted rubric, or
narrower policy profile.

The proposed direction is to separate:

- `reasoning_level`: the kind and amount of judgment the work requires.
- execution policy: whether a specific actor, model, or workflow may perform the
  work unattended under current constraints.

This spike is intentionally HITL because the risky part is the global execution
policy rubric and compatibility mapping, not the mechanics. It does not define
the backlog-review synthesis rubric; that domain-specific rubric is tracked by
`60381`.

## Tasks

- [ ] Inventory current uses of `afk` and `hitl` tags in active work items,
      archived work items, prompts, task selection, and Sandcastle flow.
- [ ] Propose a reasoning-level rubric with objective criteria and examples for
      each level.
- [ ] Define how current `afk` and `hitl` tags map to the proposed
      reasoning-level model during a compatibility period.
- [ ] Define model or actor capability thresholds that map reasoning levels to
      unattended, assisted, or human-only execution modes.
- [ ] Identify categories that must remain human-approved regardless of model
      capability, such as repository guardrails, secrets, CI policy, deployment
      authority, and architecture decisions.
- [ ] Define how `dv task ready` and Sandcastle selection preserve current
      behavior until an explicit migration is accepted.
- [ ] Recommend whether to adopt, defer, or reject the reasoning-level model.
- [ ] Identify which domain-specific rubrics, including backlog-review
      synthesis, should reference the reasoning-level model without being
      blocked by a future migration.

## Deliverables

- Reasoning-level rubric with examples.
- Compatibility mapping from current `afk` and `hitl` tags.
- Proposed execution-policy threshold model.
- Migration risks and rollback guidance.
- Recommendation to adopt, defer, or reject the model.
- Guidance for domain-specific reasoning rubrics that should continue using
  AFK/HITL tags until this model is adopted.

## Acceptance Criteria

- [ ] The spike distinguishes work complexity from execution permission.
- [ ] The rubric gives concrete examples for every proposed reasoning level.
- [ ] The mapping preserves current `dv task ready` and Sandcastle behavior
      unless a future ADR or work item explicitly changes it.
- [ ] The recommendation identifies which work must remain human-approved
      regardless of model capability.
- [ ] Follow-up AFK implementation work can be created without reopening the
      rubric discussion.
- [ ] The spike explicitly distinguishes global execution-policy classification
      from the backlog-review synthesis rubric.

## Relationships

- `reference`: `[[60377-work-item-governance-kernel]]`
