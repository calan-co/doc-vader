---
id: wi-60328
title: Formula, Work-Graph Orchestration, and BYOR
type: work-item
subtype: story
lifecycle: inactive
status: closed
status_reason: completed
priority: medium
estimated: 5
actual: 1
completed_date: '2026-06-09'
links:
  depends_on:
    - '[[237-doc-vader-context-coordination-core-epic.md]]'
    - '[[239-concurrent-claim-and-dependency-aware-selection.md]]'
    - '[[240-policy-evidence-and-alias-integrity.md]]'
tags:
  - formulas
  - work-graph
  - byor
  - integration
---

## Goal

Support reusable formula templates and typed BYOR inputs so recurring workflows can instantiate predictable work graphs without making orchestration the policy owner.

## Background

The PRD includes formula/work-graph contracts, distributed inputs and outputs, and explicit support for projection and lineage as additive evidence. This slice is where reusable workflows and external inputs become first-class, while @templjs/context-graph and @templjs/semantify remain supporting substrates rather than orchestration cores.

## Tasks

- Define the minimal formula/work-graph contract needed for v1.
- Instantiate deterministic workflow structures from formula templates.
- Support BYOR and distributed input/output typing.
- Integrate projection-fed evidence and lineage as supporting context, not policy authority.

## Deliverables

- Formula template and work-graph contract.
- BYOR source typing and external artifact handling.
- Projection-fed evidence path that can consume context-graph and semantify outputs.

## Acceptance Criteria

- [ ] Formula templates produce deterministic, policy-conformant work graphs.
- [ ] Typed BYOR inputs are supported for distributed sources.
- [ ] Projection-fed evidence can be consumed without turning semantify into orchestration core.
- [ ] Context-graph remains a deterministic substrate, not a policy or lifecycle engine.
