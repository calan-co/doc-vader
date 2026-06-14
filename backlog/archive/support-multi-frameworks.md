---
id: wi-52469
title: Support Multiple Documentation Frameworks
type: work-item
subtype: task
lifecycle: draft
status: closed
priority: high
estimated: 4
tags:
  - afk
links:
  evidence:
    - '[[record-20260518-124800-52469]]'
    - '[[record-20260612-backlog-consolidation]]'
  reference:
    - '[[60333-canonical-schema-profile-routing-and-fixtures]]'
ordinal: 1000
status_reason: obsolete
actual: 0
completed_date: '2026-06-12'
---

## Summary

Enable Doc-Vader to support multiple documentation frameworks (e.g., Diátaxis, TGDP) simultaneously via profile-driven governance, frontmatter classification, folder conventions, and content structure.

## Acceptance Criteria

- User can select one or more framework profiles for validation (`--profile <name|path>`)
- Frontmatter and folder structure are validated for all selected profiles
- Non-interactive reconciliation strategy is available and deterministic for CI
- CLI provides actionable feedback and reconciliation trace output
- Validation output supports machine-readable JSON for downstream consumers

## Dependencies

- Schema updates for multi-framework support
- CLI enhancements for profile selection and deterministic conflict handling

## Related Work

- [[docs/project-brief.md]]
- [[framework-reconciliation.md]]
- [[172.frontmatter-schema-integration-feature.md]]

## Supersession Note

- 2026-06-12: Closed as obsolete because this work is superseded by [[60333-canonical-schema-profile-routing-and-fixtures]]. Evidence: [[record-20260612-backlog-consolidation]]; audit reference: [[backlog/audit/auditing-backlog-report]].
