---
$schema: schemas/work-management/frontmatter/record.json
id: record:wi-60523-hook-validation-20261110
title: WI-60523 hook integration validation
summary: WI-60523 hook integration validation
type: record
subtype: test-result
lifecycle: active
status: ready
status_reason: recorded
links:
  supporting_reference:
    - https://github.com/calan-co/doc-vader/pull/130
    - https://github.com/calan-co/doc-vader/commit/c00235f28d918275ca74e6f223f6d68b89ebe1fe
---

## Recorded At

2026-11-10T15:05:24.106Z

## Outcome

pass

## Observation

Under a fresh prospective validation claim, the commit-message hook regression and schema repository integration test both passed. The hook accepts a Conventional Commit and rejects an invalid message. Documentation lint, rebuilt backlog validation, CI-grade local audit, and normal pre-push checks passed. Prior full prerequisite suite passed 687 tests with zero failures and two skipped; lint and typecheck passed.

## Subject References

- wi-60523
- claim:af23645a45c226788540e9c34cf5997cd85af2036eadd2e2bd958641051d290c
- wi:60523

## Supporting References

- https://github.com/calan-co/doc-vader/pull/130
- https://github.com/calan-co/doc-vader/commit/c00235f28d918275ca74e6f223f6d68b89ebe1fe

## Notes

- The original implementation predates this claim; this claim covers validation and integration only.
- Remaining jsonschema-tools references in package.json, the pre-commit command, and schema-repository tests are live dependencies/integrations. The pre-commit comment was neutralized without changing its materialization command; historical evidence was preserved.
- Pre-push initially rejected completed WI-60527 because its Tasks section was missing. Added a truthful checked task summary and reran docs/backlog/pre-push gates successfully without changing enforcement.
- This records local results, not GitHub CI success, merge, or publication.
