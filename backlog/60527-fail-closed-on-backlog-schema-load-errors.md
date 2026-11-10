---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60527
title: Fail Closed On Backlog Schema Load Errors
summary: Make backlog validation report schema-load errors as errors and resolve external schema-map routing without consumer-local shadow copies.
type: work-item
subtype: bug
lifecycle: active
status: completed
status_reason: completed
priority: high
completed_date: '2026-11-10'
links:
  evidence:
    - '[[record-wi-60527-prerequisite-validation-20261110]]'
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/130
tags:
  - afk
  - validation
  - schemas
---

## Reproduction

From a clean Vitae checkout, run:

```sh
node /Users/macos/Library/pnpm/doc-vader-runtime/dist/cli/doc-vader.js backlog validate \
  --dir backlog --profile ci --format json --fail-on error \
  --schema-map /Users/macos/Library/pnpm/doc-vader-runtime/schemas/frontmatter/schema-map.json
```

The JSON reports `schema_load_errors` for explicit
`schemas/work-management/frontmatter/work-item.json` references, but exits zero.
The supplied map does not route those explicit consumer-relative schema URIs to the
runtime schema suite.

## Acceptance Criteria

- [x] Schema-load errors cause `--fail-on error` to exit nonzero.
- [x] An explicit schema URI can be resolved through an installed/runtime schema map without copying a shadow schema tree into the consumer.
- [x] Regression coverage uses an external consumer fixture and preserves ordinary schema violations and baseline reporting semantics.
