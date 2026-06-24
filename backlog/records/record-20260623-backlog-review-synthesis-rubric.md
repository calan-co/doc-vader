---
$schema: schemas/work-management/frontmatter/record.json
id: record:20260623-backlog-review-synthesis-rubric
title: Backlog review synthesis rubric approval
summary: Records the accepted backlog review synthesis rubric and follow-up proposal contract for wi-60381.
type: record
subtype: approval
lifecycle: active
status: ready
status_reason: recorded
links:
  supporting_reference:
    - '[[60381-reasoned-backlog-review-rubric]]'
    - '[[60382-review-synthesis-and-grilling-capture]]'
---

## Recorded At

2026-06-23T00:00:00Z

## Outcome

approved

## Observation

The backlog review synthesis rubric was accepted after a grilling session focused
on unblocking AFK-ready follow-up execution. The accepted boundary separates the
deterministic review core from reasoning-backed synthesis, avoids personhood as
a formal capability boundary, and routes approval requirements through
scope-authority pairs.

Accepted implementation guidance:

- `60382` naturally depends on both `60380` and `60381`.
- `60382` renders grilling prompts from already-reasoned synthesis input; it
  does not infer unresolved decisions from raw findings and does not call an LLM
  provider.
- Follow-up recommendations are emitted as a single schema-backed,
  creation-command-ready JSON proposal batch.
- Proposal batches use deterministic provisional work-item ids plus
  `sha256:<hex>` dedupe keys.
- Proposals with `requiredApprovals` must not include `afk`; absence of `afk`
  defaults to guarded handling under current policy.
- The proposal batch is non-mutating and uses `materializationMode:
  propose-only`.

## Subject References

- [[60381-reasoned-backlog-review-rubric]]
- [[60382-review-synthesis-and-grilling-capture]]

## Supporting References

- [[60379-reasoning-level-execution-policy-spike]]
- [[60380-deterministic-backlog-review-profile]]
