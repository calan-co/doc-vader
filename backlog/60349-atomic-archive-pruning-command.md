---
id: wi-60349
title: Atomic Archive Pruning Command
summary: Implement archive pruning on the task command surface with configured archive-root boundaries and durable per-file pruned-index persistence before deletion.
type: work-item
subtype: story
lifecycle: active
status: paused
status_reason: blocked
priority: medium
estimated: 8
links:
  depends_on:
    - '[[60347-configured-archive-validation-cli-slice]]'
    - '[[60348-pruned-index-contract-and-historical-resolver-semantics]]'
  reference:
    - '[[60339-agent-command-surface-for-skills-and-sandcastle]]'
  evidence:
    - '[[record-20260616-043441-60349]]'
tags:
  - archive
  - pruning
  - command-surface
  - afk
---

## Parent

[doc-vader Context Coordination PRD](../docs/how-to/implementation-plans/doc-vader-context-coordination-prd.md)

## What to build

Implement archive pruning on the task command surface so completed archived Markdown files can be removed only after their historical record is durable in the pruned index. The command must honor configured archive roots, reject candidates outside those roots, define and enforce dirty-worktree behavior, persist and re-read each pruned-index record before deleting that file, and continue safely when an individual candidate fails.

## Acceptance criteria

- [ ] A task command surface supports archived pruning with deterministic human and machine-readable output.
- [ ] Pruning categorically refuses candidates outside configured archive roots.
- [ ] Eligibility checks include archive validation, completed/closed historical status, configured grace behavior, and pruned-index contract requirements.
- [ ] Dirty worktree or uncommitted archive-candidate behavior is explicit and tested.
- [ ] Each file is pruned atomically: persist the pruned-index record, re-read it, then delete that source file.
- [ ] A failed candidate leaves its source file intact and does not stop unrelated eligible candidates from being evaluated.
- [ ] Tests cover successful pruning, skipped candidates, validation failures, dirty candidates, and per-file persistence-before-delete behavior.

## Blocked by

- [[60347-configured-archive-validation-cli-slice]]
- [[60348-pruned-index-contract-and-historical-resolver-semantics]]
