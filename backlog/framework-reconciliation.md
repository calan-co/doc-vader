---
id: wi-60275
status: proposed
title: Framework Reconciliation Workflow
lifecycle: draft
priority: medium
type: work-item
subtype: task
links:
  depends_on:
    - '[[support-multi-frameworks.md]]'
ordinal: 1000
estimated: 4
---

## Summary

Implement a deterministic workflow to reconcile conflicting rules when multiple documentation frameworks are selected in Doc-Vader.

## Acceptance Criteria

- CLI detects conflicts between selected frameworks
- Reconciliation supports non-interactive strategy selection (`--strategy`)
- Strategy selection is deterministic and CI-safe (no interactive prompts required)
- Selected strategy is applied consistently to validation and fixing logic
- Clear feedback and documentation for reconciliation process and tie-break rules

## Dependencies

- Multi-framework support
- CLI enhancements for user interaction

## Related Work

- [[support-multi-frameworks.md]]
- [[docs/project-brief.md]]
