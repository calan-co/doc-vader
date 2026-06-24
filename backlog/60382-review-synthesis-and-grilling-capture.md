---
id: wi-60382
title: Review Synthesis and Grilling Capture
summary: Capture reasoned review synthesis, render focused grilling prompts, and emit proposal batches without mutating work items or expanding active session scope.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: medium
estimated: 4
actual: 4
completed_date: '2026-06-23'
links:
  depends_on:
    - '[[60380-deterministic-backlog-review-profile]]'
    - '[[60381-reasoned-backlog-review-rubric]]'
  evidence:
    - '[[record-20260623-backlog-review-synthesis-rubric]]'
  reference:
    - '[[../docs/architecture/decisions/adr-005-entity-governance-primitive-model.md]]'
    - '[[../docs/architecture/decisions/adr-010-composable-evaluation-primitives.md]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
tags:
  - afk
  - backlog
  - review
  - synthesis
  - grill
---

## Goal

Implement the capture surface for reasoned backlog review synthesis, focused
grilling prompt rendering, and non-mutating follow-up proposal batches after the
deterministic backlog review profile exists and the HITL rubric is accepted.

## Background

Reports aggregate findings and deterministic summaries. Synthesis interprets
those findings for an actor audience. That reasoned layer should be captured
explicitly, linked to the source report and subjects, and prevented from silently
mutating work-item status, tags, checkboxes, records, claims, locks, or files.

The deterministic backlog review profile and backlog review synthesis rubric are
complete. This item is tagged AFK because the implementation is mechanical with
those inputs available.

This item does not implement reasoning or invoke an LLM provider. It accepts
already-reasoned synthesis input, validates it, renders prompts from declared
open questions and decision branches, and emits schema-backed proposal batches
that a future creation command can consume.

## Tasks

- [x] Define the record or artifact shape for storing review synthesis linked to
      a report, findings, and affected subjects.
- [x] Define the synthesis input fields required to render prompts
      deterministically, including subject refs, finding refs, open question,
      recommended answer, rationale, evidence refs, decision branches,
      confidence, and required approvals.
- [x] Render focused grilling prompts from unresolved synthesis items and source
      findings without inferring new decision branches from raw findings.
- [x] Define `schemas/work-management/support/work-item-proposal-batch.json`
      for non-mutating follow-up proposal batches.
- [x] Emit creation-command-ready proposal batches for off-scope conversation
      branches instead of expanding the current session or writing work items.
- [x] Validate proposal `frontmatter` against
      `schemas/work-management/frontmatter/work-item.json` and proposal
      `content` against `schemas/work-management/content/work-item.json`.
- [x] Enforce deterministic provisional `frontmatter.id` values, unique
      `sha256:<hex>` dedupe keys, and batch-level uniqueness for both fields.
- [x] Enforce `materializationMode: propose-only` and reject `afk` proposal tags
      whenever `requiredApprovals` is nonempty.
- [x] Preserve non-mutation by default: no lifecycle transition, checkbox
      marking, tag change, record write, claim creation, lock mutation, file
      write, or closure action from synthesis capture alone.
- [x] Add JSON output suitable for agents and readable output suitable for
      maintainers.
- [x] Add tests for synthesis capture, prompt rendering, proposal-batch
      validation, dedupe uniqueness, AFK approval rejection, and non-mutating
      behavior.

## Deliverables

- Synthesis capture model or record contract.
- Grilling prompt renderer for accepted synthesis input.
- Work-item proposal batch schema under `schemas/work-management/support/`.
- Follow-up work-item proposal batch output for off-scope branches.
- Tests covering non-mutating behavior.

## Acceptance Criteria

- [x] Synthesis is stored separately from deterministic report summaries.
- [x] Rendered grilling prompts include subject refs, finding refs, open
      questions, recommended answers, rationale, evidence refs, decision
      branches, confidence, required approvals, and recommended decision order.
- [x] Off-scope branches can be emitted as schema-backed work-item proposal
      batches without changing the active review scope.
- [x] Proposal batches are single JSON documents by default and are suitable as
      stdin for a future creation command.
- [x] Proposal `frontmatter` and `content` validate against the canonical
      work-item schemas before output.
- [x] Duplicate `frontmatter.id` or duplicate `dedupeKey` values are rejected.
- [x] Proposals with nonempty `requiredApprovals` cannot include the `afk` tag.
- [x] Synthesis capture never mutates work-item lifecycle state by default.
- [x] The implementation does not invoke a reasoning provider or infer
      unresolved decisions from raw deterministic findings.
- [x] The implementation depends on completed deterministic review and synthesis
      rubric inputs.

## Relationships

- `depends_on`: `[[60380-deterministic-backlog-review-profile]]`,
  `[[60381-reasoned-backlog-review-rubric]]`
