# Archived Staging Scripts

This directory contains deprecated staging scripts and migration-era utilities
that are no longer part of the active validation or migration pipeline.

Archived here:

- Legacy orchestrators that were replaced by the unified CLI or remark pipeline
- One-off remediation utilities that served a completed migration
- Fixer utilities superseded by maintained lint rules and schema validation

Current replacement entrypoints live in the TS/ESM core surfaces:

- `scripts/docs-remark-lint.ts`
- `staging/scripts/docs-lint.sh`
- `staging/scripts/backlog-hygiene-ci.sh`
- `lib/plugins/remark-frontmatter-schema.ts`
- `lib/frontmatter/index.ts`
- `lib/schema/resolver.ts`
- `lib/plugins/remark-lint-crossref.ts`
- `lib/plugins/remark-lint-naming-conventions.ts`
- `lib/plugins/remark-lint-template-compliance.ts`
- `lib/plugins/remark-lint-no-ascii-diagrams.ts`
- `lib/plugins/remark-lint-no-html-anchors.ts`
- `lib/plugins/remark-lint-checklist.ts`
- `staging/scripts/lint/work-item-hierarchy-lint.cjs` until WI-190 lands

Refer to WI-192 for the archival policy and WI-182/WI-190/WI-191 for
remaining migration work.
