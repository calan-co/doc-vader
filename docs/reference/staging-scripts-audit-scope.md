---
id: stg-230
title: Epic 180 Staging Scripts Audit Scope
type: document
subtype: reference
lifecycle: draft
status: proposed
tags:
  - staging
  - audit
  - migration
  - epic-180
links:
  related:
    - '[[staging-scripts-inventory.md]]'
    - '[[remark-lint-unified-architecture.md]]'
    - '[[../../backlog/180.staging-script-consolidation-epic.md]]'
    - '[[../../backlog/230.define-epic-180-audit-scope-task.md]]'
---

## Purpose

Defines the exact boundaries, categorization rules, and Epic 170 overlap-review criteria governing the Epic 180 staging-script consolidation audit. This document must be read before executing WI-181 (audit) or WI-182 (migration).

## Audit Scope

### Folders in Scope

| Folder | Contents |
|---|---|
| `staging/scripts/lint/` | Per-rule CJS/MJS lint scripts (22 files) |
| `staging/scripts/utils/` | Shared CJS utility modules (2 files) |
| `staging/scripts/` (root) | Orchestration scripts and shell runners (5 files) |
| `staging/` (root) | One-time TypeScript remediation scripts (7 `.mts` files) |

### Folders Out of Scope

- `staging/remediate-frontmatter*.mts` are **in scope** as candidates for deprecation only; no migration work is planned for them (see Deprecated category).
- Schema files live in `schemas/` (not under `staging/`); they are not part of this audit.

## Categorization Outcomes

Each asset is assigned one of four outcomes:

### 1. Subsumed (Archive Now)

A script whose functionality is **fully replaced** by an existing TypeScript ESM plugin in `lib/plugins/` or module in `lib/`. No further migration work is needed — the script is ready for archival as part of WI-192.

Decision rule: A script is Subsumed when a corresponding `lib/plugins/remark-*.ts` or `lib/` module provides equivalent validation or transformation logic that is wired into the unified processor or CLI.

### 2. Core / Migrate

A script that provides **unique value not yet available in `lib/`** and must be rewritten as TypeScript ESM. These become the backlog tasks WI-189, WI-190, WI-191, or new tasks created during the audit.

Decision rule: A script is Core when its checks are referenced in active linting flows and no corresponding `lib/plugins/` file exists.

### 3. Deprecated

A script that is **no longer used** in any active lint flow, was superseded by schema validation, or was a one-time remediation utility. These are archived with a deprecation notice in `staging/archived/`.

Decision rule: A script is Deprecated when it is not referenced in `package.json` scripts, `docs-lint.sh`, `backlog-hygiene-ci.sh`, or pre-commit hooks; or when it is a versioned remediation artifact.

### 4. Compatibility Shim (Retain)

A script or shell runner that is still **actively invoked** by CI or pre-commit hooks but whose long-term replacement is not yet complete. It is retained in place until its TypeScript replacement is shipped.

Decision rule: A script is a Compatibility Shim when it is referenced in `package.json`, `.husky/`, or CI workflows and no drop-in TypeScript replacement is available yet.

## Epic 170 Overlap Rules

Overlap with Epic 170 affects the Subsumed vs Core determination:

| Epic 170 Plugin | Supersedes Staging Script(s) |
|---|---|
| `remark-frontmatter-schema.ts` (Track A) | `frontmatter-lint.cjs`, `frontmatter-fix.cjs` |
| `remark-lint-crossref.ts` (Track C) | `crossref-lint.cjs`, `crossref-fix.cjs` |
| `remark-lint-naming-conventions.ts` (Track C) | `naming-conventions-lint.cjs`, `naming-conventions-fix.cjs` |
| `remark-lint-template-compliance.ts` (Track B) | `template-lint.cjs` |
| `remark-lint-no-ascii-diagrams.ts` | `diagram-lint.cjs`, `ascii-to-mermaid-fix.cjs`, `convert-ascii-to-mermaid.cjs` |
| `remark-lint-checklist.ts` | `remark-content-rules.cjs` (partially) |

A staging script is only considered **Subsumed** when the corresponding Epic 170 plugin has shipped (i.e., merged to `staging`) **and** is wired into the processor or CLI. Scripts superseded by plugins that are still `status: proposed` or `status: ready` are marked **Core / Migrate** until the plugin ships.

## Audit Execution Notes

1. Run `find staging/ -name '*.cjs' -o -name '*.mjs' -o -name '*.mts' -o -name '*.js' -o -name '*.sh'` to verify the file set before auditing.
2. Cross-reference each file against `package.json` `scripts`, `.husky/pre-commit`, `staging/scripts/docs-lint.sh`, and `staging/scripts/backlog-hygiene-ci.sh`.
3. For each file, record: name, purpose, current references, Epic 170 status, and recommended outcome.
4. The inventory table is maintained in `docs/reference/staging-scripts-inventory.md`.
