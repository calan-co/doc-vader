---
id: wi-60352
title: Prune Reporting and Audit Boundary
summary: Decide the report and audit boundary for archive pruning outcomes, skipped candidates, retries, validation failures, and successful deletions.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: medium
estimated: 2
links:
  depends_on:
    - '[[60349-atomic-archive-pruning-command]]'
  evidence:
    - '[[record-20260616-043441-60352]]'
tags:
  - archive
  - pruning
  - audit
  - hitl
---

## Parent

[doc-vader Context Coordination PRD](../docs/how-to/implementation-plans/doc-vader-context-coordination-prd.md)

## What to build

Decide whether archive prune failures should create audit records or remain structured command output with unchanged source files. Define the prune report shape for skipped candidates, retries, validation failures, successful per-file deletions, and any evidence links needed for human review.

## Acceptance criteria

- [ ] The decision states whether prune failures create audit records or remain structured command output.
- [ ] The prune report format includes skipped candidates, retry attempts, validation failures, successful deletions, and durable pruned-index references.
- [ ] The decision explains when unchanged source files are sufficient evidence after a failure.
- [ ] Human review guidance is explicit for policy-blocked or ambiguous prune outcomes.
- [ ] Follow-on implementation work can add the report format without reopening the audit boundary decision.

## Dependencies

- [[60349-atomic-archive-pruning-command]]
