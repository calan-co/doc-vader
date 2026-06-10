---
id: wi-60329
title: Integration Seam Contract for Concurrent Conflict Tests in CI
type: work-item
subtype: task
lifecycle: active
status: ready
priority: medium
estimated: 2
links:
  depends_on:
    - '[[237-doc-vader-context-coordination-core-epic.md]]'
    - '[[239-concurrent-claim-and-dependency-aware-selection.md]]'
    - '[[240-policy-evidence-and-alias-integrity.md]]'
  evidence:
    - '[[record-20260610-202104-60329]]'
tags:
  - integration
  - ci
  - concurrency
  - seam-contract
---

## Goal

Define and verify the minimum integration seam contract for concurrent execution conflict tests in CI so claim, dependency, and policy interactions are testable end to end.

## Background

The context coordination PRD leaves an explicit open question: the minimal integration seam contract for concurrent execution conflict tests in CI is not yet confirmed. Schema and CLI seams are clear, but the integration seam must be explicit to prevent drift between claim handling, dependency-aware selection, and policy gating behavior.

## Tasks

- Define the CI integration seam contract for concurrent conflict scenarios.
- Enumerate required fixtures and deterministic conflict cases.
- Specify expected outcomes for overlap, dependency violation, and policy-blocked transitions.
- Wire a minimal CI gate that executes this seam contract.

## Deliverables

- Integration seam contract document section or fixture contract.
- Deterministic conflict test matrix for concurrent execution behavior.
- CI-executed test target validating the seam contract.

## Acceptance Criteria

- [ ] A single, explicit integration seam contract exists for concurrent conflict tests.
- [ ] The contract includes overlap claim conflicts, dependency ordering conflicts, and policy-gated pause behavior.
- [ ] Test fixtures and expected outcomes are deterministic and machine-verifiable.
- [ ] CI runs the seam contract tests and fails on regressions.

## Notes

- Keep the seam minimal and focused on behavior that cannot be fully proven at schema-only or CLI-only seams.
- Preserve fail-closed semantics as a non-negotiable invariant.
