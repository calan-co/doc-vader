---
id: wi-215
type: work-item
subtype: task
lifecycle: active
status: ready
title: Update Validation Code to Use DRY Resolver
summary: Refactor validation to use unified resolver
priority: medium
audience:
  - developers
governance:
  profiles:
    - technical-decision
tags:
  - validation
  - refactor
  - dry
estimated: 3
links:
  depends_on:
    - '[[211-fix_jsonschema_tools_compatibility]]'
    - '[[214-create_dry_schema_resolver]]'
---

## Files to Update

1. **lib/frontmatter/lint.ts**
   - Update `validateFrontmatter()` signature to accept `config?: DocVaderConfig`
   - Replace hardcoded schema resolution with `resolveSchema()`
   - Handle both inline schemas and references
   - Update error handling

2. **lib/backlog/audit.ts**
   - Update `determineSchemaTarget()` to accept `config: DocVaderConfig`
   - Use `resolveSchema()` instead of local logic
   - Check `item.data.$schema` first (respects per-file overrides)
   - Update callers to pass config

3. **lib/frontmatter/utils.ts** (if needed)
   - Update any schema loading helpers
   - Ensure they work with new resolution logic

4. **remark-lint plugins** (if using schemas)
   - Update plugin options to reference schemas from config
   - May need schema path in plugin options

## Changes Per File

### lib/frontmatter/lint.ts

```typescript
// Add to function signature:
export async function validateFrontmatter({
  // ... existing params ...
  config?: DocVaderConfig,  // NEW
}): Promise<ValidateResult> {
  // ...
  const schemaRef = resolveSchema({ data, config, filePath });

  if (typeof schemaRef === 'object') {
    // Handle inline schema
  } else if (typeof schemaRef === 'string') {
    // Handle schema reference
  }
}
```

### lib/backlog/audit.ts

```typescript
// Update determineSchemaTarget:
function determineSchemaTarget(
  item: BacklogItem,
  config: DocVaderConfig, // NEW parameter
): string | null {
  const schemaRef = resolveSchema({
    data: item.data,
    config,
    filePath: item.file,
  });
  return typeof schemaRef === "string" ? schemaRef : null;
}
```

## Acceptance Criteria

- [ ] `validateFrontmatter()` uses `resolveSchema()`
- [ ] `determineSchemaTarget()` uses `resolveSchema()`
- [ ] Both code paths have consistent precedence
- [ ] Inline schemas work in both paths
- [ ] Per-file `$schema` overrides respected
- [ ] Fallback to defaults when no schema specified
- [ ] No regressions in existing validation
- [ ] All callers updated to pass config
- [ ] Tests pass

## Testing

- [ ] Unit tests for both functions with resolver
- [ ] Integration test: inline schema validates
- [ ] Integration test: $schema override works
- [ ] Integration test: type/subtype mapping works
- [ ] Integration test: default config fallback works
