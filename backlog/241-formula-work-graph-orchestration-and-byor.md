---
id: wi-60328
title: Formula, Work-Graph Orchestration, and BYOR
type: work-item
subtype: story
lifecycle: active
status: closed
status_reason: completed
priority: medium
estimated: 5
actual: 1
completed_date: "2026-06-09"
links:
  depends_on:
    - "[[237-doc-vader-context-coordination-core-epic.md]]"
    - "[[239-concurrent-claim-and-dependency-aware-selection.md]]"
    - "[[240-policy-evidence-and-alias-integrity.md]]"
  pull_requests:
    - "https://github.com/calan-co/doc-vader/pull/59"
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

- [x] Defined the minimal formula/work-graph contract needed for v1.
- [x] Instantiated deterministic workflow structures from formula templates.
- [x] Supported BYOR and distributed input/output typing.
- [x] Integrated projection-fed evidence and lineage as supporting context, not policy authority.

## Deliverables

- Formula template and work-graph contract.
- BYOR source typing and external artifact handling.
- Projection-fed evidence path that can consume context-graph and semantify outputs.

## Acceptance Criteria

- [x] Formula templates produce deterministic, policy-conformant work graphs.
- [x] Typed BYOR inputs are supported for distributed sources.
- [x] Projection-fed evidence can be consumed without turning semantify into orchestration core.
- [x] Context-graph remains a deterministic substrate, not a policy or lifecycle engine.
