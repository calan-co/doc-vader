---
id: doc-vader-project-brief
title: Doc-Vader Project Brief
type: project-brief
status: closed
status_reason: redundant
lifecycle: ideation
priority: high
ordinal: 1000
---

## Project Overview

Doc-Vader is a schema-driven documentation validation CLI supporting multiple documentation frameworks (e.g., Diátaxis, TGDP) simultaneously. It enforces compliance and frontmatter standards, validates, classifies, and auto-fixes markdown documentation using markdown templates, frontmatter parsing and schema-based validation. Framework selection, classification, and folder/content structure are managed via frontmatter and directory conventions. If conflicting frameworks are selected, users are prompted to reconcile rules via guided options.

## Objectives

- Support multiple documentation frameworks (Diátaxis, TGDP, etc.)
- Enforce documentation structure and classification via frontmatter and folders
- Validate YAML frontmatter against strict schemas
- Auto-fix folder/frontmatter and framework mismatches
- Provide CLI for validation, linting, fixing, and reconciliation
- Support versioned schema resolution and symlink management

## Key Features

- Frontmatter validation
- Multi-framework classification and enforcement
- Folder/content structure validation for selected frameworks
- Schema directive support for custom validation
- Reconciliation workflow for conflicting framework rules
- Integration testing support
- Domain-based CLI commands

## Stakeholders

- Documentation authors
- Technical writers
- Engineering teams
- QA and compliance

## Success Criteria

- All documentation passes schema validation
- Documentation structure is enforced for all selected frameworks
- CLI commands provide actionable feedback, auto-fix, and reconciliation options
- Integration tests cover all critical workflows

## Risks & Mitigations

- **Schema drift**: Regular updates and tests for schema files
- **User error in frontmatter**: Auto-fix and clear error reporting
- **Complex folder migrations**: Dry-run support and clear CLI output
- **Framework conflicts**: Prompt user for reconciliation, provide guided options

## References

- CONTRIBUTING.md for standards
- schemas/frontmatter/document/latest.json for schema rules
- templates/template-mapping.md for TGDP → Diátaxis mapping

## Next Steps

- Finalize multi-framework validation and reconciliation logic
- Expand integration test coverage
- Document CLI usage, workflows, and framework selection
- Gather feedback from stakeholders

## Closure Note

- 2026-02-27: Closed during backlog triage as redundant. Evidence: `backlog/audit/auditing-backlog-report.json` listed this item in `no_inbound_active`, and it is outside the current MVP critical path in `docs/how-to/implementation-plans/doc-vader-shared-engine-mvp.plan.md`.
- Replacement: [[docs/project-brief.md]]
- Detail: Canonical project brief has moved to docs and is maintained there.
