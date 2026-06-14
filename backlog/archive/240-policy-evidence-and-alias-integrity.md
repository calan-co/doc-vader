---
id: wi-60327
title: Policy, Evidence, and Alias Integrity
type: work-item
subtype: story
lifecycle: active
status: closed
priority: high
estimated: 5
links:
  evidence:
    - '[[record-20260610-202104-60327]]'
    - '[[record-20260612-hitl-60327]]'
    - '[[record-20260612-backlog-consolidation]]'
  reference:
    - '[[60337-context-coordination-policy-and-ci-seams]]'
tags:
  - policy
  - evidence
  - provenance
  - aliases
  - hitl
status_reason: obsolete
actual: 0
completed_date: '2026-06-12'
---

## Goal

Make policy composition, evidence capture, and alias integrity monotonic and auditable so context decisions stay explainable without overstating certainty.

## Background

The PRD requires composed least-privilege policy chaining, immutable manifests, inferential edges with confidence metadata, hash-verified alias resolution, and append-only migration events. This slice owns the integrity lane that keeps decision evidence trustworthy.

## Tasks

- Define composed least-privilege policy behavior with explicit gating and advisory decisions.
- Persist inferential evidence with confidence and provenance metadata.
- Support immutable identity plus append-only alias migration events.
- Block or mark non-authoritative any unresolved advisory alias resolution.

## Deliverables

- Policy composition rules.
- Evidence and provenance artifacts.
- Alias integrity and migration behavior.

## Acceptance Criteria

- [ ] Policy composition is monotonic and explainable.
- [ ] Inferential evidence is preserved with provenance and confidence.
- [ ] Alias relocation remains hash-verified and append-only.
- [ ] Unresolved advisory aliases do not silently become authoritative.

## Supersession Note

- 2026-06-12: Closed as obsolete because this work is superseded by [[60337-context-coordination-policy-and-ci-seams]]. Evidence: [[record-20260612-backlog-consolidation]]; audit reference: [[backlog/audit/auditing-backlog-report]].
