---
id: "217"
type: work-item
subtype: task
lifecycle: active
status: proposed
title: Update Schemas to Explicitly Support @context/@type
description: |
  Add explicit @context and @type property definitions to all frontmatter schemas (document and work-item). Do NOT use unevaluatedProperties: true.
  Instead, explicitly define these properties with proper documentation.
summary: Explicit @context/@type definitions in schemas
priority: low
audience: [developers]
governance:
  profiles: [technical-decision]
tags: [schemas, json-ld, properties]
estimated: 2
links:
  depends_on:
    - "[[211-fix_jsonschema_tools_compatibility]]"
---

## Files to Update

1. **schemas/frontmatter/by-type/document/current.json** (and v\*.json)
2. **schemas/frontmatter/by-type/document/latest.json** (symlink, may not need update)
3. **schemas/frontmatter/by-type/work-item/current.json** (and v\*.json)
4. **schemas/frontmatter/by-type/work-item/latest.json** (symlink, may not need update)
5. **schemas/examples/minimal-schema.json**

## Changes Per File

### Add to properties object (within allOf)

```json
{
  "type": "object",
  "properties": {
    "@context": {
      "title": "JSON-LD Context",
      "description": "Optional JSON-LD context for vocabulary mapping (inline or reference)",
      "oneOf": [
        {
          "type": "string",
          "format": "uri",
          "description": "URI reference to external context file"
        },
        {
          "type": "object",
          "description": "Inline JSON-LD context object"
        },
        {
          "type": "array",
          "description": "Array of contexts for composition",
          "items": {
            "oneOf": [
              { "type": "string", "format": "uri" },
              { "type": "object" }
            ]
          }
        }
      ]
    },
    "@type": {
      "title": "JSON-LD Type",
      "description": "Schema.org or other linked data type identifier",
      "oneOf": [
        {
          "type": "string",
          "examples": ["CreativeWork", "Task"]
        },
        {
          "type": "array",
          "items": { "type": "string" },
          "examples": [["CreativeWork", "Task"]]
        }
      ]
    }
  }
}
```

## Implementation Notes

- Keep `unevaluatedProperties: false` for strict validation
- Add properties in final `allOf` object alongside other properties
- Both @context and @type are optional (no required)
- Use `oneOf` to allow multiple input formats
- Document both string URIs and inline objects

## Acceptance Criteria

- [ ] @context property defined in document schema
- [ ] @type property defined in document schema
- [ ] @context property defined in work-item schema
- [ ] @type property defined in work-item schema
- [ ] Both properties documented with descriptions
- [ ] Both properties use oneOf for format flexibility
- [ ] unevaluatedProperties remains false
- [ ] Schemas still validate correctly

## Validation

- [ ] Frontmatter with inline @context validates
- [ ] Frontmatter with @context URI validates
- [ ] Frontmatter with @type validates
- [ ] Frontmatter without @context/@type still validates
- [ ] Invalid @context format rejected
- [ ] Unexpected properties still rejected (unevaluatedProperties: false)
