---
id: stg-188
title: Staging Scripts Inventory
type: document
subtype: reference
lifecycle: draft
status: proposed
tags:
  - staging
  - audit
  - inventory
  - epic-180
links:
  related:
    - '[[staging-scripts-audit-scope.md]]'
    - '[[../../backlog/188.task-create-staging-inventory.md]]'
    - '[[../../backlog/184.story-inventory-staging-scripts.md]]'
    - '[[../../backlog/180.staging-script-consolidation-epic.md]]'
---

## Purpose

Complete inventory of all scripts and modules in the `staging/` tree. Each entry is classified per the categories defined in [staging-scripts-audit-scope.md](staging-scripts-audit-scope.md) and is annotated with its migration priority and overlap status with Epic 170.

**Categories:** S = Subsumed | C = Core/Migrate | D = Deprecated | SH = Compatibility Shim

---

## `staging/scripts/docs-lint.sh`

| File | Purpose | Category | Priority | Notes |
|---|---|---|---|---|
| `docs-lint.sh` | Shell runner for the remark-lint pipeline; called by `nx run doc-vader:docs-lint` | SH | Retain | Update to remove any remaining legacy sub-calls once Epic 170 Track A–C ship |
| `backlog-hygiene-ci.sh` | CI gate for backlog validation; writes JSON report artifact | SH | Retain | No migration needed; retain as CI runner |
| `lint.js` | Legacy ESM orchestrator invoking CJS lint scripts by name | D | Low | No active references in `package.json` or CI; archive |
| `generate-templates-from-schema.js` | Auto-generates doc/work-item templates from JSON schema | D | Low | Not referenced in `package.json`; archive with note if schema-driven generation is reintroduced |
| `generate-validation-workflow-doc.js` | Generates validation workflow documentation from schema | D | Low | Not referenced anywhere; archive |

---

## `staging/scripts/lint/` — Subsumed by Epic 170

Scripts in this group are fully replaced by TypeScript ESM plugins in `lib/plugins/`. They are **ready for archival** once the corresponding Epic 170 plugin is merged.

| File | Purpose | Category | Epic 170 Replacement | Plugin Status |
|---|---|---|---|---|
| `frontmatter-lint.cjs` | Validates frontmatter against JSON schemas using Ajv | S | `remark-frontmatter-schema.ts` | Merged (Track A) |
| `crossref-lint.cjs` | Validates cross-references resolve to existing anchors/files | S | `remark-lint-crossref.ts` | Merged (Track C) |
| `naming-conventions-lint.cjs` | Enforces file naming rules for docs and work items | S | `remark-lint-naming-conventions.ts` | Merged (Track C) |
| `template-lint.cjs` | Validates documents against required template structure | S | `remark-lint-template-compliance.ts` | Merged (Track B) |
| `diagram-lint.cjs` | Validates diagrams use Mermaid (not ASCII box-drawing) | S | `remark-lint-no-ascii-diagrams.ts` | Merged |
| `remark-content-rules.cjs` | Custom remark rules: checklists, crossref, API spec root key | S | `remark-lint-checklist.ts` + `remark-lint-crossref.ts` | Merged |
| `anchor-lint.cjs` | Detects raw HTML anchor tags (`<a id=...>`) in docs | S | `remark-lint-no-html-anchors.ts` | Merged |

---

## `staging/scripts/lint/` — Core / Migrate

Scripts in this group provide unique validation logic not yet present in `lib/plugins/`. Each has a corresponding backlog task.

| File | Purpose | Category | Backlog Task | Priority |
|---|---|---|---|---|
| `work-item-hierarchy-lint.cjs` | Validates Epic→Feature→Story→Task hierarchy and parent links | C | WI-190 | High |

---

## `staging/scripts/lint/` — Deprecated

Scripts in this group are no longer referenced by any active hook, CI job, or npm script. They are candidates for archival under `staging/archived/` (WI-192).

| File | Purpose | Why Deprecated |
|---|---|---|
| `crossref-fix.cjs` | Auto-suggests fixes for broken cross-references | Suggestions handled by remark plugin; fix scripts are one-time utilities |
| `frontmatter-fix.cjs` | Suggests fixes for missing/malformed frontmatter | Replaced by schema validation; manual or automated fix is out of scope |
| `naming-conventions-fix.cjs` | Auto-fixes naming convention violations | Not referenced; naming issues surfaced by `remark-lint-naming-conventions.ts` |
| `ascii-to-mermaid-fix.cjs` | Converts ASCII diagrams to Mermaid stubs | One-time utility; no active references |
| `convert-ascii-to-mermaid.cjs` | Converts ASCII diagrams to Mermaid | Duplicate of above; not referenced |
| `heading-style-fix.cjs` | Fixes ATX→Setext heading style (MD003) | markdownlint-cli2 `--fix` handles this; not referenced |
| `fix-all-errors.cjs` | Orchestrates all major fix scripts | Legacy orchestrator; no active references |
| `fix-all-errors-prioritized.cjs` | Prioritised variant of fix-all-errors | Same as above |
| `chatmode-lint.cjs` | Validates chatmode file structure and completeness | Chatmode-specific; not part of doc-vader core |
| `folder-structure-lint.cjs` | Checks for legacy docs folder items (prd, stories, etc.) | Targets legacy folder schema; superseded by Diataxis placement rules (Epic 170 Track B) |
| `story-structure-lint.mjs` | Validates `*.story.md` file content structure | Legacy; work items now live in `backlog/*.md`, not `docs/stories/` |
| `doc-status-transition-lint.cjs` | Checks git-based status transitions for doc frontmatter | Schema enforces allowed status values; git-based transition checking not wired into any pipeline |
| `readme-structure-lint.cjs` | Validates README structure against templates | Not referenced; README validation not in active CI gate |
| `lint-util.cjs` | Shared file discovery and argument parsing utilities | No longer needed once dependent lint scripts are archived |

---

## `staging/scripts/utils/` — Subsumed

| File | Purpose | Category | Replacement |
|---|---|---|---|
| `frontmatter.cjs` | Extracts and validates frontmatter using Ajv | S | `lib/frontmatter/` modules |
| `selectSchema.cjs` | Selects the correct JSON schema for a file by type | S | `lib/schema/resolver.ts` |

---

## `staging/*.mts` — Deprecated

All top-level `.mts` scripts are one-time frontmatter remediation utilities. Frontmatter has been stabilised via Epic 210 and WI-235/WI-236. These scripts are safe to archive.

| File | Purpose | Why Deprecated |
|---|---|---|
| `remediate-frontmatter.mts` | Initial frontmatter remediation script | Superseded by v7 and final |
| `remediate-frontmatter-v2.mts` | V2 iteration | Superseded |
| `remediate-frontmatter-v3.mts` | V3 iteration | Superseded |
| `remediate-frontmatter-v5.mts` | V5 iteration | Superseded |
| `remediate-frontmatter-v6.mts` | V6 iteration | Superseded |
| `remediate-frontmatter-v7.mts` | V7 (final iteration) | One-time use; remediation complete |
| `remediate-frontmatter-final.mts` | Named "final" version | One-time use; remediation complete |

---

## Summary

| Category | Count |
|---|---|
| Subsumed (archive when Epic 170 plugin is merged) | 9 |
| Core / Migrate (tracked in backlog) | 1 |
| Deprecated (archive via WI-192) | 19 |
| Compatibility Shim (retain) | 2 |
| **Total** | **31** |

### Migration Blockers

- `work-item-hierarchy-lint.cjs` (WI-190): No TypeScript ESM replacement yet. Must be migrated before archival.

### Epic 170 Dependency

The 7 Subsumed scripts in `staging/scripts/lint/` may be archived as soon as the corresponding Epic 170 plugins are confirmed merged. Per the audit scope rules, archival is gated on plugin ship, not just plugin implementation.
