---
id: wi-60315
title: Canonical Schema Integration with Configuration System
summary: Schema/config/validation system unification - jsonschema-first approach
type: work-item
subtype: epic
lifecycle: active
status: closed
priority: high
estimated: 4
links:
  evidence:
    - '[[record-20260518-124800-60315]]'
    - '[[record-20260612-backlog-consolidation]]'
  reference:
    - '[[60333-canonical-schema-profile-routing-and-fixtures]]'
tags:
  - schemas
  - config
  - validation
  - architecture
  - afk
execution:
  phases:
    - name: 'Phase 1: Foundation'
      mode: sequential
      status: not-started
      items:
        - '211'
    - name: 'Phase 2: Core Systems'
      mode: parallel
      status: not-started
      phases:
        - name: Configuration System Track
          mode: sequential
          status: not-started
          items:
            - '212'
            - '213'
            - '214'
            - '215'
        - name: JSON-LD Schema Track
          mode: sequential
          status: not-started
          items:
            - '217'
            - '218'
    - name: 'Phase 3: Documentation & Integration'
      mode: sequential
      status: not-started
      items:
        - '216'
        - '219'
    - name: 'Phase 4: Extensibility & Testing'
      mode: parallel
      status: not-started
      items:
        - '220'
        - '221'
    - name: 'Phase 5: Migration'
      mode: sequential
      status: not-started
      items:
        - '222'
        - '223'
    - name: 'Phase 6: Validation & Testing'
      mode: parallel
      status: not-started
      items:
        - '209'
        - '224'
status_reason: obsolete
actual: 0
completed_date: '2026-06-12'
---

## Goal

Unify schema handling around jsonschema-first principles with:

- TypeBox configuration schema matching doc-vader's JSON Schema 2020-12 focus
- Canonical schema structure (by-type/, support/) fully integrated
- DRY schema resolution (single code path, 4-level precedence)
- JSON-LD vocabulary mapping support (inline-first precedence)
- Extensible subtypes via x-\* namespace
- Comprehensive schema documentation and test fixtures

## Acceptance Criteria

- [ ] All 7 steps implemented and integrated
- [ ] No regressions in existing validation (backlog audit, frontmatter lint, remark plugins)
- [ ] Configuration system loads correctly with extends resolution
- [ ] DRY resolver used by both frontmatter and audit validation
- [ ] JSON-LD @context/@type explicitly defined in all schemas
- [x] Minimal schema requirements documented with working example
- [ ] All paths migrated from old to new structure
- [x] Pre-commit hook passes with canonical schemas
- [ ] Test fixtures validate correctly

## Notes

- Step 1 (jsonschema-tools compatibility) is approved but not yet implemented
- TypeBox is jsonschema-first (important - replaces Zod)
- JSON-LD @context/@type must be explicit (no unevaluatedProperties: true)
- Configuration system uses TypeBox + AJV (no new dependencies)
- New work item 209 tracks execution-item-ownership lint validation rule
- New work item 224 tracks execution-item-status-validity lint validation rule
- 2026-03-11: Commit `00a8da0` added the canonical work-management foundation package (`docs/reference/work-management/`, `schemas/work-management/`, `templates/reference/work-management/`) and a runnable example graph, satisfying the epic-level documentation/example milestone while the config, JSON-LD, and migration work remains open.
- 2026-03-11: The same commit passed the repo pre-commit materialization hook after regenerating `schemas/frontmatter/support/base/1.0.0.json` from `current.json`, so the canonical schema hook path is now functioning for staged changes.

## Supersession Note

- 2026-06-12: Closed as obsolete because this work is superseded by [[60333-canonical-schema-profile-routing-and-fixtures]]. Evidence: [[record-20260612-backlog-consolidation]]; audit reference: [[backlog/audit/auditing-backlog-report]].
