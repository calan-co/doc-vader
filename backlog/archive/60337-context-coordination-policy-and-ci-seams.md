---
id: wi-60337
title: Context Coordination Policy and CI Seams
summary: Finish the remaining context-coordination work around policy evidence, alias integrity, execution-item linting, and CI seams for concurrent conflict behavior.
type: work-item
subtype: story
lifecycle: active
status: closed
status_reason: obsolete
priority: high
estimated: 8
actual: 0
completed_date: '2026-06-12'
links:
  evidence:
    - '[[record-20260612-backlog-consolidation]]'
    - '[[record-20260612-context-coordination-pivot]]'
  reference:
    - '[[archive/237-doc-vader-context-coordination-core-epic]]'
    - '[[archive/240-policy-evidence-and-alias-integrity]]'
    - '[[archive/242-integration-seam-contract-for-concurrent-conflict-ci]]'
    - '[[archive/224-execution_item_status_validity_lint]]'
    - '[[60333-canonical-schema-profile-routing-and-fixtures]]'
    - '[[60335-backlog-automation-scan-and-finalization]]'
    - '[[60336-github-app-deployment-and-protected-ci-wiring]]'
tags:
  - context
  - coordination
  - policy
  - hitl
  - obsolete
---

## Goal

Finish the context-coordination control plane by connecting policy/evidence integrity, alias provenance, execution-item validation, and CI conflict seams into one testable path.

## User Stories

1. As a maintainer, I want policy decisions and alias migrations to be monotonic and auditable, so that context coordination does not overstate certainty.
2. As a concurrent contributor, I want conflict behavior tested in CI, so that overlapping work and policy-blocked transitions fail predictably.
3. As an automation agent, I want execution-item status validity checked by the same policy model, so that ready selection and conflict handling stay consistent.

## What To Build

Implement or finalize policy composition, evidence provenance, hash-verified alias migration, execution-item status validity linting, and CI seam tests for concurrent conflict behavior. This slice remains HITL where policy semantics or CI expectations require design acceptance.

## Acceptance Criteria

- [ ] Policy composition is monotonic and explainable.
- [ ] Evidence, provenance, and alias migrations preserve confidence and authority boundaries.
- [ ] Execution-item status validity linting uses the same lifecycle/readiness semantics as the coordination model.
- [ ] CI seams cover overlap, dependency violation, and policy-blocked transitions.
- [ ] HITL design boundaries are recorded before changing policy semantics or CI expectations.

## Blocked By

Closed as obsolete. Execution-item validation moved to [[60333-canonical-schema-profile-routing-and-fixtures]], automation/provenance/conflict reporting moved to [[60335-backlog-automation-scan-and-finalization]], and hosted enforcement authority remains with [[60336-github-app-deployment-and-protected-ci-wiring]].

## Closure Notes

- 2026-06-12: Closed as obsolete with evidence in [[record-20260612-context-coordination-pivot]]. The mixed HITL slice was split into targeted implementation and authority concerns.

## Supersedes

- [[archive/237-doc-vader-context-coordination-core-epic]]
- [[archive/240-policy-evidence-and-alias-integrity]]
- [[archive/242-integration-seam-contract-for-concurrent-conflict-ci]]
- [[archive/224-execution_item_status_validity_lint]]
