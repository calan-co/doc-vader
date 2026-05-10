---
id: wi-211
type: work-item
subtype: task
lifecycle: active
status: in-progress
title: Fix jsonschema-tools Compatibility (Remove Custom Version Metadata)
summary: Align schemas to JSON Schema 2020-12 (remove custom metadata)
priority: medium
tags: [schemas, jsonschema-tools, standards]
estimated: 3
commits:
  00a8da0: "feat(work-management): add canonical foundation package"
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
- [x] `pnpm exec jsonschema-tools materialize-modified --staged` passes
- [ ] AJV can resolve schemas via updated `$id` URIs
- [ ] No functional changes to schema validation

## Implementation

Use automated find-replace across schemas directory, verify each file, test with materialization.

## Notes

- 2026-03-11: Commit `00a8da0` updated `schemas/frontmatter/support/base/current.json`, regenerated `schemas/frontmatter/support/base/1.0.0.json` via the pre-commit materialization hook, and successfully completed `git commit` with `pnpm exec jsonschema-tools materialize-modified --staged` running in-hook.
- 2026-03-11: Remaining work is still the bulk metadata migration across legacy schema files. `schemas/frontmatter/document/*` still contains `version` and `$versioningScheme`, so this task stays `in-progress`.
