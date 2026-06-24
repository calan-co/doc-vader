---
id: wi-60377
title: Work Item Governance Kernel
summary: Extract shared Work Item lifecycle, readiness, dependency, evidence, and archive verdicts behind one deep module for CLI, scan, lint, and task adapters.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 5
actual: 5
completed_date: '2026-06-20'
links:
  depends_on:
    - '[[60363-runtime-entity-schemas]]'
  reference:
    - '[[../docs/architecture/decisions/adr-008-work-item-governance-kernel]]'
    - '[[../docs/architecture/decisions/adr-006-task-command-surface-work-item-canonical-model]]'
    - '[[../docs/architecture/decisions/adr-009-storage-and-format-seams]]'
    - '[[../docs/how-to/implementation-plans/doc-vader-entity-governance-architecture-prd]]'
  evidence:
    - '[[task-record-preflight]]'
    - '[[record-sandcastle-task-validation-passed]]'
tags:
  - afk
  - architecture
  - work-management
  - kernel
---

## Goal

Create a shared Work Item Governance Kernel that produces canonical
machine-readable verdicts for Work Item lifecycle, readiness, dependency,
evidence, and archive decisions.

## Background

Architecture review found Work Item governance rules duplicated across
work-management mutation, remark validation, backlog scan, task loading, task
readiness, archive validation, and frontmatter linting. Task remains a command
projection over canonical Work Item entities, so task commands must consume
shared Work Item verdicts rather than reimplementing policy.

The kernel should consume canonical Work Item records supplied by storage and
format adapters. MVP adapters may be limited to Git-managed Markdown with YAML
frontmatter and JSON payloads, but the kernel must not require callers to pass
raw Markdown or raw filesystem paths as its semantic input.

## Implementation Notes

- Current rule sites now split into shared kernel verdicts plus adapter glue:
  - `lib/work-management/kernel.ts` owns lifecycle, readiness, dependency,
    AFK/HITL, evidence, and archive verdicts.
  - `lib/task/model.ts` and `lib/task/ready.ts` consume those verdicts without
    changing task command output.
  - `lib/backlog/scan-conditions.ts`, `lib/backlog/archive-validation.ts`,
    `lib/plugins/work-item-validation.ts`, and
    `lib/work-management/frontmatter-lint.ts` still carry command-specific
    backlog, lint, and archive checks for the next migration slices.
- Remaining adapter migration order:
  1. `dv task show|prompt|claim|ready`
  2. backlog scan executor and scan conditions
  3. remark and frontmatter archive/evidence lint plugins
  4. work-management mutation and archive-finalization helpers

## Tasks

- [x] Inventory Work Item rules currently implemented in work-management, task,
      scan, lint, plugin, and archive modules.
- [x] Define the kernel verdict vocabulary for lifecycle validity, readiness,
      dependencies, AFK/HITL classification, evidence, and archive eligibility.
- [x] Define the canonical Work Item record shape consumed by the kernel, leaving
      Markdown/YAML parsing and file loading behind adapters.
- [x] Add focused tests for kernel verdicts using representative active,
      blocked, closed, archived, and dependency-linked Work Items.
- [x] Refactor one low-risk adapter to consume kernel verdicts without changing
      observable command output.
- [x] Document the adapter migration order for remaining CLI, scan, lint, and
      task surfaces.

## Deliverables

- Work Item Governance Kernel module.
- Canonical Work Item record contract consumed by the kernel.
- Kernel verdict tests.
- One migrated adapter using the kernel.
- Follow-up migration checklist for remaining adapters.

## Acceptance Criteria

- [x] Work Item readiness and dependency answers are available through one
      shared kernel verdict surface.
- [x] Task command behavior can consume Work Item verdicts without defining a
      separate lifecycle model.
- [x] Existing observable behavior remains stable unless a linked ADR or PRD
      explicitly changes it.
- [x] Tests prove the kernel handles active, blocked, archived, and
      dependency-linked Work Items.

## Relationships

- `depends_on`: `[[60363-runtime-entity-schemas]]`
- `implements`: `[[../docs/architecture/decisions/adr-008-work-item-governance-kernel]]`
- `supports`: `[[60368-fail-closed-ready-list-show]]`
