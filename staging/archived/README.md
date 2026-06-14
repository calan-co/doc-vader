# Archived Staging Scripts

This directory contains deprecated staging scripts that are no longer part of
the active validation or migration pipeline.

Archived here:

- Legacy orchestrators that were replaced by the unified CLI or remark pipeline
- One-off remediation utilities that served a completed migration
- Fixer utilities superseded by maintained lint rules and schema validation

Current active staging entrypoints remain outside this folder:

- `staging/scripts/docs-lint.sh`
- `staging/scripts/backlog-hygiene-ci.sh`
- `staging/scripts/lint/work-item-hierarchy-lint.cjs`
- `staging/scripts/utils/frontmatter.cjs`
- `staging/scripts/utils/selectSchema.cjs`

Refer to WI-192 for the archival policy and WI-182/WI-190/WI-191 for
remaining migration work.
