---
id: wi-213
type: work-item
subtype: task
lifecycle: active
status: ready
title: Create Configuration Loader with Extends Support (lib/config/loader.ts)
summary: Config loader with extends inheritance and deep merging
priority: medium
governance:
  profiles:
    - technical-decision
tags:
  - config
  - typebox
  - ajv
  - loader
estimated: 3
links:
  depends_on:
    - '[[211-fix_jsonschema_tools_compatibility]]'
    - '[[212-create_typebox_config_schema]]'
---

## File to Create

`lib/config/loader.ts`

## Core Features

1. **ConfigLoader class**:
   - Compile TypeBox schema once (performance)
   - Load and parse JSON config files
   - Validate against TypeBox schema using AJV
   - Resolve extends recursively
   - Merge configs with deep merge strategy

2. **Extends resolution**:
   - Detect circular extends
   - Support NPM package references (`@scope/package`)
   - Support relative paths (resolved from config dir)
   - Process extends chains (A extends B extends C)

3. **Config merging**:
   - Primitives: override wins
   - Objects: deep merge (child properties override)
   - Arrays: complete replacement
   - Preserve defaults from schema

4. **Error handling**:
   - File not found errors
   - JSON parse errors
   - Schema validation errors with AJV error details

## Implementation Points

- Use existing AJV instance from project
- Apply schema defaults during validation
- Circular extends detection via Set
- Recursive resolution for nested extends
- Convenience function: `loadDocVaderConfig()`

## Acceptance Criteria

- [ ] ConfigLoader class fully implemented
- [ ] Circular extends detected and error thrown
- [ ] Extends chains resolved correctly
- [ ] Configs merged with proper precedence
- [ ] Validation errors reported with details
- [ ] NPM package resolution works
- [ ] Relative path resolution works
- [ ] `loadDocVaderConfig()` convenience function works

## Test Scenarios

- [ ] Load config without extends
- [ ] Load config with single extends
- [ ] Load config with multiple extends (array)
- [ ] Circular extends throws error
- [ ] Deep merge of schemaMap works
- [ ] Validation fails on invalid config
- [ ] Defaults applied from schema
