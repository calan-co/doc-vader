---
$schema: schemas/work-management/frontmatter/record.json
id: record:20260612-hosted-app-pivot
title: Hosted GitHub App pivot decision record
summary: Records the backlog decision to close the local CI adoption slice and move durable guardrail decisions into the hosted-service and published GitHub App ADR.
type: record
subtype: audit-note
lifecycle: active
status: ready
status_reason: recorded
---

## Recorded At

2026-06-12T12:00:00.000Z

## Outcome

noted

## Observation

The durable direction for Doc-Vader automation is a hosted backend with a published GitHub App. The standalone local CI adoption and legacy deprecation slice does not add enough independent rigor to remain active; its useful guardrail constraints now belong in the hosted-app architecture decision.

## Subject References

- [[work-item-60331]]
- [[work-item-60336]]

## Findings

- Decision: close wi-60331 as obsolete.
- Decision: preserve the non-weakening CI/script guardrail constraints in wi-60336.
- Constraint: any workflow, required-check, workflow-permission, secret, bypass, branch-protection, or existing guardrail-script change remains HITL unless explicitly approved in the implementing turn.
- Constraint: interim local CI/script changes should be temporary, non-weakening, and aligned with the hosted-service and published GitHub App migration path.

## Supporting References

- [[archive/60331-ci-adoption-and-legacy-deprecation-gate]]
- [[work-item-60336]]
