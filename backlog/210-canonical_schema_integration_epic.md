---
id: wi-210
type: work-item
subtype: epic
lifecycle: active
status: proposed
title: Canonical Schema Integration with Configuration System
description: |
  Complete schema integration and validation overhaul: adopt canonical schema structure (by-type/support/),
  implement TypeBox-based configuration system with extends support, add JSON-LD vocabulary mapping,
  and establish minimal schema requirements. This epic blocks all configuration-, schema-, and
  validation-related work.
summary: Schema/config/validation system unification - jsonschema-first approach
audience: [developers, architects]
tags: [schemas, config, validation, architecture]
execution:
  phases:
    - name: "Phase 1: Foundation"
      mode: sequential
      status: not-started
      items: ["211"]

    - name: "Phase 2: Core Systems"
      mode: parallel
      status: not-started
      phases:
        - name: "Configuration System Track"
          mode: sequential
          status: not-started
          items: ["212", "213", "214", "215"]

        - name: "JSON-LD Schema Track"
          mode: sequential
          status: not-started
          items: ["217", "218"]

    - name: "Phase 3: Documentation & Integration"
      mode: sequential
      status: not-started
      items: ["216", "219"]

    - name: "Phase 4: Extensibility & Testing"
      mode: parallel
      status: not-started
      items: ["220", "221"]

    - name: "Phase 5: Migration"
      mode: sequential
      status: not-started
      items: ["222", "223"]
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
- [ ] Minimal schema requirements documented with working example
- [ ] All paths migrated from old to new structure
- [ ] Pre-commit hook passes with canonical schemas
- [ ] Test fixtures validate correctly

## Notes

- Step 1 (jsonschema-tools compatibility) is approved but not yet implemented
- TypeBox is jsonschema-first (important - replaces Zod)
- JSON-LD @context/@type must be explicit (no unevaluatedProperties: true)
- Configuration system uses TypeBox + AJV (no new dependencies)
- New work item 209 tracks execution-item-ownership lint validation rule
- New work item 224 tracks execution-item-status-validity lint validation rule
