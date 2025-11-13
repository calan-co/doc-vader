---
id: support-multi-frameworks
status: proposed
title: Support Multiple Documentation Frameworks
lifecycle: draft
priority: high
type: work-item
subtype: feature
---

## Summary

Enable Doc-Vader to support multiple documentation frameworks (e.g., Diátaxis, TGDP) simultaneously via frontmatter classification, folder, and content structure.

## Acceptance Criteria

- User can select one or more documentation frameworks for validation
- Frontmatter and folder structure are validated for all selected frameworks
- If frameworks have conflicting rules, user is prompted to select reconciliation options
- CLI provides actionable feedback and guided reconciliation workflow

## Dependencies

- Schema updates for multi-framework support
- CLI enhancements for framework selection and conflict handling

## Related Work

- Project brief
- Diátaxis validation logic
