---
id: "222"
type: work-item
subtype: task
lifecycle: active
status: proposed
title: Update Code Defaults to Canonical Schema Paths
description: |
Update hardcoded schema paths in code from old structure (schemas/frontmatter/document/) to new canonical structure (schemas/frontmatter/by-type/document/). Affects ~8 files.
summary: Migrate code defaults to new schema paths
owner: ~
audience: [developers]
governance: refactor
tags: [schema, paths, migration]
estimated: 1
links:
  depends_on:
    - "[[216-document_schema_requirements]]"
---

## Files to Update

1. **lib/backlog/audit.ts**
   - Lines ~224-225: Update default schemaMap paths
   - OLD: `schemas/frontmatter/work-item/current.json`
   - NEW: `schemas/frontmatter/by-type/work-item/latest.json`

2. **staging/scripts/utils/selectSchema.cjs**
   - Lines ~15, 22: Update path mappings for docs/ and backlog/
   - OLD: Uses old directory structure
   - NEW: Points to by-type/{type}/latest.json

3. **staging/scripts/lint/doc-status-transition-lint.cjs**
   - Update schema reference for status-transition-payload
   - Verify paths point to canonical structure

4. **test files** (if any hardcoded paths)

## Changes

Example change for audit.ts:

```typescript
// BEFORE
const defaults: SchemaMapConfig = {
  byType: {
    "work-item": "schemas/frontmatter/work-item/current.json",
    document: "schemas/frontmatter/document/current.json",
  },
};

// AFTER
const defaults: SchemaMapConfig = {
  byType: {
    "work-item": "schemas/frontmatter/by-type/work-item/latest.json",
    document: "schemas/frontmatter/by-type/document/latest.json",
  },
};
```

## Acceptance Criteria

- [ ] lib/backlog/audit.ts updated
- [ ] staging/scripts/utils/selectSchema.cjs updated
- [ ] staging/scripts/lint/doc-status-transition-lint.cjs updated
- [ ] No hardcoded old paths remain in main code
- [ ] All validation tests pass
- [ ] Schema resolution works with new paths
