---
id: wi-60333
title: Canonical Schema Template and Profile Routing
summary: Finish schema/template/config unification, profile-aware routing, JSON-LD context support, extension discovery, fixture coverage, and path migration as one schema governance slice.
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: medium
estimated: 10
actual: 2
completed_date: '2026-06-17'
links:
  evidence:
    - '[[record-20260612-backlog-consolidation]]'
    - '[[record-20260612-framework-readiness-pivot]]'
    - '[[record-20260612-context-coordination-pivot]]'
  reference:
    - '[[archive/210-canonical_schema_integration_epic]]'
    - '[[archive/211-fix_jsonschema_tools_compatibility]]'
    - '[[archive/213-create_config_loader]]'
    - '[[archive/214-create_dry_schema_resolver]]'
    - '[[archive/215-update_validation_to_use_resolver]]'
    - '[[archive/216-document_schema_requirements]]'
    - '[[archive/217-update_schemas_for_json_ld]]'
    - '[[archive/219-configure_contexts_in_config]]'
    - '[[archive/220-extensible_subtypes]]'
    - '[[archive/221-add_test_fixtures]]'
    - '[[archive/222-update_code_defaults]]'
    - '[[archive/223-migrate_schema_directives]]'
    - '[[archive/235.multi-profile-schema-routing-task]]'
    - '[[archive/236.deterministic-reconciliation-core-task]]'
    - '[[archive/support-multi-frameworks]]'
    - '[[archive/60334-framework-reconciliation-and-release-readiness-decisions]]'
    - '[[archive/224-execution_item_status_validity_lint]]'
    - '[[archive/60337-context-coordination-policy-and-ci-seams]]'
tags:
  - canonical
  - schema
  - template
  - profile
  - extensibility
  - afk
---

## Goal

Finish the canonical schema, template, config, and profile-routing foundation so validation can resolve schemas and templates deterministically across local config, profiles, JSON-LD contexts, discovered extension packs, extensible subtypes, and migrated directives.

## User Stories

1. As a maintainer, I want schema resolution to be deterministic and profile-aware, so that multi-framework validation is reliable in CI.
2. As a downstream consumer, I want config, contexts, template packs, schema packs, and extension tokens documented with fixtures, so that custom document types such as ADRs can be adopted without code changes.
3. As an automation agent, I want code defaults and schema directives migrated to canonical paths, so that validation does not depend on legacy aliases.
4. As a tool integrator, I want explicit configuration to override presence detection, so that hosted and local execution resolve the same schema/template set.

## What To Build

Complete the schema/template/config foundation end to end: remove incompatible schema metadata, load and merge config, discover and explicitly configure schema/template packs, resolve schemas and templates through one code path, support JSON-LD contexts and x-* extensibility, route validation by selected profiles, emit deterministic reconciliation traces for RC-safe multi-framework conflicts, document requirements, add fixtures, validate execution-item status references, and keep framework-reconciliation behavior deployable without reopening the broader release strategy decision.

## Acceptance Criteria

- [x] Schema metadata and IDs are compatible with JSON Schema tooling and AJV resolution.
- [x] Config loading, schema resolution, template resolution, and validation callers share one deterministic resolver path.
- [x] Schema/template packs can be added by presence detection or explicit config without source-code changes.
- [x] ADR-style schema/template extension fixtures prove the extension mechanism works outside built-in document types.
- [x] JSON-LD context/type support, x-* subtype extensibility, and vocabulary contexts are configured and tested.
- [x] One or more selected profiles route schema behavior deterministically and expose selected-profile/routing outcomes.
- [x] Framework/profile conflicts resolve through deterministic, non-interactive behavior suitable for local validation, CI, and hosted-service execution.
- [x] Execution-item status validity linting detects invalid phase/item references with deterministic diagnostics.
- [x] Code defaults and frontmatter schema directives use canonical paths.
- [x] Documentation and fixtures cover minimal, feature-complete, profile-routed, and extension cases.

## Blocked By

None - can start immediately.

## Supersedes

- [[archive/210-canonical_schema_integration_epic]]
- [[archive/211-fix_jsonschema_tools_compatibility]]
- [[archive/213-create_config_loader]]
- [[archive/214-create_dry_schema_resolver]]
- [[archive/215-update_validation_to_use_resolver]]
- [[archive/216-document_schema_requirements]]
- [[archive/217-update_schemas_for_json_ld]]
- [[archive/219-configure_contexts_in_config]]
- [[archive/220-extensible_subtypes]]
- [[archive/221-add_test_fixtures]]
- [[archive/222-update_code_defaults]]
- [[archive/223-migrate_schema_directives]]
- [[archive/235.multi-profile-schema-routing-task]]
- [[archive/236.deterministic-reconciliation-core-task]]
- [[archive/support-multi-frameworks]]
- [[archive/60334-framework-reconciliation-and-release-readiness-decisions]]
- [[archive/224-execution_item_status_validity_lint]]
- [[archive/60337-context-coordination-policy-and-ci-seams]]
