---
id: wi-212
type: work-item
subtype: task
lifecycle: active
status: ready
title: Create TypeBox Configuration Schema (lib/config/schema.ts)
summary: TypeBox schema definitions for .doc.json config
priority: medium
governance:
  profiles:
    - technical-decision
tags:
  - config
  - typebox
  - schema
  - jsonschema
estimated: 2
links:
  depends_on:
    - '[[211-fix_jsonschema_tools_compatibility]]'
---

## File to Create

`lib/config/schema.ts`

## Schema Objects

1. **SchemaMapConfigSchema**: Type/subtype routing rules
2. **ValidationConfigSchema**: Validation strictness options
3. **BacklogConfigSchema**: Backlog audit settings
4. **VocabularyConfigSchema**: JSON-LD context configuration
5. **DocVaderConfigSchema**: Main config with extends support

## Key Features

- TypeBox `Type.*` definitions for all config sections
- Generates valid JSON Schema 2020-12
- `Static<T>` types for TypeScript inference
- Supports `extends` (string | string[]) for inheritance
- Uses `additionalProperties: false` for strict validation
- Descriptions for all properties (self-documenting)

## Acceptance Criteria

- [ ] All 5 schema objects defined
- [ ] TypeScript types exported via `Static<typeof T>`
- [ ] Schema is valid JSON Schema 2020-12
- [ ] Supports `extends` as string or array
- [ ] All properties have descriptions
- [ ] Compiles without TypeScript errors

## Dependencies

- Requires TypeBox npm package
