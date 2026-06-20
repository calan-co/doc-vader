---
$schema: /frontmatter/document
id: adrworki-9672
title: Create a Work Item Governance Kernel
type: document
subtype: generic
status: ready
lifecycle: active
tags:
  - adr
  - architecture
  - work-management
  - kernel
links:
  reference:
    - '[[../../../backlog/60377-work-item-governance-kernel]]'
    - '[[adr-006-task-command-surface-work-item-canonical-model.md]]'
---

## Context and Problem Statement

Work Item governance behavior is currently spread across work-management
mutation, remark validation, backlog scan, task loading, task readiness, archive
validation, and frontmatter linting modules. Each caller knows part of the
frontmatter shape, lifecycle semantics, dependency readiness, AFK/HITL
classification, evidence rules, or archive state.

This makes the current modules shallow: their interfaces expose nearly as much
complexity as their implementations, and deleting one module only moves the same
rules into another caller.

## Decision

Create a Work Item Governance Kernel as the deep module that owns canonical
Work Item interpretation and verdicts.

The kernel owns:

- Work Item loading and normalization from governed markdown records.
- Lifecycle and status validity.
- Dependency readiness.
- AFK/HITL classification.
- Completion and closure evidence readiness.
- Archive eligibility inputs.
- Machine-readable verdicts with reasons and remediation hints.

CLI commands, task commands, remark plugins, backlog scan, archive validation,
and Sandcastle adapters must call the kernel instead of reimplementing Work Item
rules.

## Decision Drivers

- The interface is the test surface; Work Item behavior needs one high-value
  seam.
- Agents and humans need consistent ready/list/show/scan/lint answers.
- Package authors need a pattern for adding future entity governance kernels.
- Current duplication creates drift risk as runtime entities are added.

## Consequences

Positive:

- Work Item rule changes have high locality.
- Tests can target kernel verdicts and reuse them through CLI and plugin
  adapters.
- Task command behavior can stay ergonomic without becoming authoritative.

Negative/Risks:

- Refactoring must be staged to avoid breaking existing CLI and scan behavior.
- The kernel must not absorb unrelated markdown traversal or schema compilation;
  those belong to separate corpus and schema governance modules.

## Validation

- Add kernel tests for lifecycle, dependency, evidence, AFK/HITL, and archive
  verdicts.
- Refactor one adapter at a time to consume kernel verdicts.
- Preserve existing CLI and scan observable behavior unless a PRD/ADR explicitly
  changes it.
