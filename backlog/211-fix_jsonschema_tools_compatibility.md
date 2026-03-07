---

id: "211"
type: work-item
subtype: task
lifecycle: active
status: in-progress
title: Fix jsonschema-tools Compatibility (Remove Custom Version Metadata)
description: |
Remove non-standard `version` and `$versioningScheme` properties from all schema files
and encode version information in `$id` URI paths. This aligns schemas with JSON Schema
2020-12 standards and fixes pre-commit hook materialization errors.
summary: Align schemas to JSON Schema 2020-12 (remove custom metadata)
owner: ~
audience: [developers]
governance: technical-decision
tags: [schemas, jsonschema-tools, standards]
estimated: 3
---

## Changes

Update ~30 schema files across:

- `schemas/frontmatter/by-type/document/*`
- `schemas/frontmatter/by-type/work-item/*`
- `schemas/frontmatter/support/base/*`
- `schemas/frontmatter/support/contracts/*`
- `schemas/frontmatter/support/overlays/*`
- `schemas/frontmatter/support/payloads/*`

### Per-file changes

1. Remove `"version": "1.0.0"` property
2. Remove `"$versioningScheme": "semver"` property
3. Update `$id` to include version in path:

   ```json
   // BEFORE
   { "$id": "https://raw.githubusercontent.com/.../current.json" }

   // AFTER
   { "$id": "https://raw.githubusercontent.com/.../v1.0.0.json" }
   ```

## Acceptance Criteria

- [ ] All schema files updated
- [ ] No `version` or `$versioningScheme` properties remain
- [ ] Version encoded in `$id` URIs
- [ ] `pnpm exec jsonschema-tools materialize-modified --staged` passes
- [ ] AJV can resolve schemas via updated `$id` URIs
- [ ] No functional changes to schema validation

## Implementation

Use automated find-replace across schemas directory, verify each file, test with materialization.
