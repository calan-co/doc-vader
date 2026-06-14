---
id: wi-214
title: Create DRY Schema Resolution Functions (lib/schema/resolver.ts)
summary: Unified schema resolution with 4-level precedence
type: work-item
subtype: task
lifecycle: active
status: closed
priority: medium
estimated: 2
links:
  evidence:
    - '[[record-20260518-124800-214]]'
    - '[[record-20260612-hitl-214]]'
    - '[[record-20260612-backlog-consolidation]]'
  reference:
    - '[[60333-canonical-schema-profile-routing-and-fixtures]]'
tags:
  - schema
  - resolver
  - validation
  - dry
  - hitl
governance:
  profiles:
    - technical-decision
status_reason: obsolete
actual: 0
completed_date: '2026-06-12'
---

## File to Create

`lib/schema/resolver.ts`

## Functions

### 1. resolveSchema(options)

Resolves schema reference with 4-level precedence:

1. **Inline schema**: `data.$inlineSchema` or `typeof data.schema === 'object'`
2. **Embedded ref**: `data.$schema` or `data.schema` (string)
3. **Property-based config**: `schemaMap.bySubtype[subtype]` or `schemaMap.byType[type]`
4. **User default**: `schemaMap.default` or `/frontmatter/{type}/`

Returns: `string | object | null` (URI/path, inline schema, or null)

### 2. resolveVocabularyContext(data, config)

Resolves JSON-LD vocabulary context with inline-first precedence:

1. Inline `@context` in frontmatter
2. Type/subtype-specific context from `config.vocabularies.contexts`
3. Default context from `config.vocabularies.defaultContext`

Returns: `string | object | null` (URI/path, context object, or null)

## Type Definitions

```typescript
interface ResolveSchemaOptions {
  data: Record<string, any>; // Frontmatter data
  config: DocVaderConfig; // Loaded configuration
  filePath?: string; // File being validated
}
```

## Integration Points

- Used by `validateFrontmatter()` in lib/frontmatter/lint.ts
- Used by `determineSchemaTarget()` in lib/backlog/audit.ts
- Used by remark plugins for schema selection

## Acceptance Criteria

- [ ] `resolveSchema()` implements all 4 levels
- [ ] `resolveVocabularyContext()` implements precedence
- [ ] Functions accept DocVaderConfig
- [ ] Handles all precedence levels correctly
- [ ] Well-documented with examples
- [ ] Return types clear (string | object | null)

## Test Scenarios

- [ ] Inline schema detected first
- [ ] Embedded $schema overrides everything except inline
- [ ] Subtype mapping checked before type mapping
- [ ] Default applies when no match
- [ ] Null returns when nothing specified
- [ ] Vocabulary context precedence correct

## Supersession Note

- 2026-06-12: Closed as obsolete because this work is superseded by [[60333-canonical-schema-profile-routing-and-fixtures]]. Evidence: [[record-20260612-backlog-consolidation]]; audit reference: [[backlog/audit/auditing-backlog-report]].
