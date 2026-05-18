---
id: stagings-2300
title: Staging Scripts Audit Scope and Categorization
summary: Defines Epic 180 audit boundaries, categorization criteria, and initial script inventory for migration and archival decisions.
type: document
subtype: how-to
lifecycle: active
status: ready
tags:
  - staging
  - migration
  - audit
  - epic-180
links:
  reference:
    - '[[180.staging-script-consolidation-epic]]'
    - '[[181.audit-staging-scripts-feature]]'
    - '[[230.define-epic-180-audit-scope-task]]'
---

## Goal

Create a deterministic audit rubric for Epic 180 so each `staging` script is classified as one of:

- `core-migrate`: move functionality into TypeScript (`lib/` or `scripts/`)
- `compatibility-shim`: retain temporarily as a bridge while migration lands
- `archive-candidate`: move to archive after replacement or explicit deprecation

## Scope

In scope for Phase 1 audit:

- `staging/scripts/lint/**`
- `staging/scripts/utils/**`
- references in `package.json` scripts and workflow entry points that call the above

Out of scope for this initial audit:

- non-script assets outside `staging/scripts/**`
- release workflow/auth changes (handled by WI-234 and WI-227)

## Categorization Criteria

### core-migrate

Use when script contains reusable domain logic or policy checks that should become part of TypeScript core.

Signals:

- validates frontmatter, hierarchy, naming, template, links, or doc policy
- overlaps with existing `lib/plugins/*` and should be unified
- needed by CI or recurring local quality gates

### compatibility-shim

Use when script currently provides glue behavior that can remain temporarily while TS implementation stabilizes.

Signals:

- schema selection helpers and wrappers
- thin adapters around already-migrated logic
- low-risk temporary path to preserve workflow continuity

### archive-candidate

Use when script is redundant, superseded, or one-off.

Signals:

- bulk fixer scripts replaced by plugin-based lint/fix workflow
- ad hoc conversion utilities not required by core policy
- duplicated implementations with maintained TS equivalents

## Initial Inventory (Phase 1 Snapshot)

| Path | Lines | Category | Notes |
| --- | ---: | --- | --- |
| `staging/scripts/lint/frontmatter-lint.cjs` | 214 | core-migrate | overlaps with `lib/frontmatter/lint.ts` and remark frontmatter plugin |
| `staging/scripts/lint/anchor-lint.cjs` | 77 | core-migrate | overlaps with no-html-anchor lint plugin |
| `staging/scripts/lint/naming-conventions-lint.cjs` | 104 | core-migrate | overlaps with naming-conventions plugin |
| `staging/scripts/lint/remark-content-rules.cjs` | 71 | compatibility-shim | adapter-like behavior; verify final ownership |
| `staging/scripts/lint/heading-style-fix.cjs` | 33 | core-migrate | fixer logic should be TS-owned |
| `staging/scripts/lint/naming-conventions-fix.cjs` | 23 | core-migrate | migrate with naming lint logic |
| `staging/scripts/lint/template-lint.cjs` | 60 | core-migrate | overlaps with template-compliance plugin |
| `staging/scripts/lint/work-item-hierarchy-lint.cjs` | 242 | core-migrate | migration target for hierarchy policy |
| `staging/scripts/lint/ascii-to-mermaid-fix.cjs` | 59 | archive-candidate | superseded by lint policy and modern diagram workflow |
| `staging/scripts/lint/crossref-lint.cjs` | 147 | core-migrate | overlaps with crossref plugin logic |
| `staging/scripts/lint/chatmode-lint.cjs` | 370 | core-migrate | large policy surface; audit dependencies first |
| `staging/scripts/lint/convert-ascii-to-mermaid.cjs` | 21 | archive-candidate | one-off utility likely superseded |
| `staging/scripts/lint/crossref-fix.cjs` | 83 | core-migrate | migrate with crossref validation path |
| `staging/scripts/lint/readme-structure-lint.cjs` | 170 | core-migrate | migrate as documentation structure rules |
| `staging/scripts/lint/folder-structure-lint.cjs` | 31 | compatibility-shim | likely replaced by Diataxis placement plugin |
| `staging/scripts/lint/frontmatter-fix.cjs` | 18 | core-migrate | frontmatter fixer migration companion |
| `staging/scripts/lint/diagram-lint.cjs` | 102 | core-migrate | migrate into unified plugin/rules pipeline |
| `staging/scripts/lint/fix-all-errors-prioritized.cjs` | 93 | archive-candidate | aggregate fixer superseded by targeted rules |
| `staging/scripts/lint/story-structure-lint.mjs` | 127 | core-migrate | migrate or merge into work-item structural checks |
| `staging/scripts/lint/fix-all-errors.cjs` | 214 | archive-candidate | aggregate fixer superseded by TS lint/fix routes |
| `staging/scripts/lint/doc-status-transition-lint.cjs` | 98 | core-migrate | aligns with lifecycle/status policy enforcement |
| `staging/scripts/lint/lint-util.cjs` | 47 | archive-candidate | utility likely subsumed by TS helpers |
| `staging/scripts/utils/selectSchema.cjs` | 61 | compatibility-shim | temporary bridge while schema router migration completes |
| `staging/scripts/utils/frontmatter.cjs` | 112 | core-migrate | core utility logic should move to TS |

## Migration Priority

1. Migrate `core-migrate` files that overlap with already-existing TS plugins first.
2. Replace `compatibility-shim` scripts only after parity checks pass in TS path.
3. Archive `archive-candidate` files only after replacement or explicit deprecation note exists.

## Validation Gate

After each migration batch:

1. `pnpm run docs:lint`
2. `pnpm run backlog:validate`
3. targeted tests for touched area (`runTests` on relevant files)
