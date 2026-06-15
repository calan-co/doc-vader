---
id: wi-60332
title: Staging Script Migration and Archive
summary: Use the staging inventory and audit scope to migrate core scripts, archive obsolete scripts, and remove active references as one verifiable migration path.
type: work-item
subtype: story
lifecycle: active
status: running
status_reason: investigation
priority: high
estimated: 8
commits:
  ebc011c73c333729b7ea4ae7ba95810c3f1272a0: 'chore(backlog): consolidate active work item backlog'
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/60
  evidence:
    - '[[record-20260612-backlog-consolidation]]'
  reference:
    - '[[archive/180.staging-script-consolidation-epic]]'
    - '[[archive/181.audit-staging-scripts-feature]]'
    - '[[archive/182.migrate-core-scripts-to-typescript-feature]]'
    - '[[archive/183.deprecate-obsolete-staging-scripts-feature]]'
    - '[[archive/184.story-inventory-staging-scripts]]'
    - '[[archive/185.story-migrate-lint-scripts]]'
    - '[[archive/186.story-migrate-validation-utils]]'
    - '[[archive/187.story-archive-deprecated-scripts]]'
    - '[[archive/188.task-create-staging-inventory]]'
    - '[[archive/189.task-migrate-frontmatter-lint]]'
    - '[[archive/190.task-migrate-hierarchy-lint]]'
    - '[[archive/191.task-migrate-frontmatter-utils]]'
    - '[[archive/192.task-move-deprecated-to-archived]]'
    - '[[archive/230.define-epic-180-audit-scope-task]]'
tags:
  - staging
  - script
  - migration
  - afk
---

## Goal

Complete the staging-script cleanup as one end-to-end migration: use the inventory, migrate core utilities into TypeScript/ESM surfaces, archive deprecated scripts, and remove active references to obsolete entrypoints.

## User Stories

1. As a maintainer, I want staging assets categorized and acted on in one migration flow, so that stale scripts stop creating ambiguity.
2. As a developer, I want core lint and validation utilities available as typed ESM modules, so that runtime behavior matches the package architecture.
3. As a contributor, I want archived scripts to explain their replacement path, so that old entrypoints do not look active.

## What To Build

Turn the staging inventory into implementation: migrate core lint and validation utilities, archive deprecated scripts with documentation, preserve compatibility shims only where justified, and update active package/docs references.

## Acceptance Criteria

- [ ] Inventory categories are applied to every relevant staging script and schema asset.
- [ ] Core lint and validation behavior is migrated to typed TypeScript/ESM modules with tests.
- [ ] Deprecated assets are moved to an archived location with rationale and replacement guidance.
- [ ] Active package scripts and docs no longer reference archived/deprecated entrypoints.
- [ ] Validation confirms the migration did not regress the unified pipeline or backlog checks.

## Blocked By

None - can start from the existing inventory and audit scope.

## Supersedes

- [[archive/180.staging-script-consolidation-epic]]
- [[archive/181.audit-staging-scripts-feature]]
- [[archive/182.migrate-core-scripts-to-typescript-feature]]
- [[archive/183.deprecate-obsolete-staging-scripts-feature]]
- [[archive/184.story-inventory-staging-scripts]]
- [[archive/185.story-migrate-lint-scripts]]
- [[archive/186.story-migrate-validation-utils]]
- [[archive/187.story-archive-deprecated-scripts]]
- [[archive/188.task-create-staging-inventory]]
- [[archive/189.task-migrate-frontmatter-lint]]
- [[archive/190.task-migrate-hierarchy-lint]]
- [[archive/191.task-migrate-frontmatter-utils]]
- [[archive/192.task-move-deprecated-to-archived]]
- [[archive/230.define-epic-180-audit-scope-task]]
