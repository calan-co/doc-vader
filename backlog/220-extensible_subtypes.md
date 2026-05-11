---
id: wi-220
type: work-item
subtype: task
lifecycle: active
status: ready
title: Enable Extensible Subtypes via x-* Pattern
summary: Extensible subtype namespace for custom document types
priority: medium
governance:
  profiles:
    - technical-decision
tags:
  - schemas
  - extensibility
  - subtypes
estimated: 2
links:
  depends_on:
    - '[[216-document_schema_requirements]]'
    - '[[219-configure_contexts_in_config]]'
---

## Files to Update

1. **schemas/frontmatter/by-type/document/current.json** (subtype property)
2. **schemas/frontmatter/by-type/document/v\*.json** (subtype property)
3. **schemas/frontmatter/by-type/work-item/current.json** (subtype property)
4. **schemas/frontmatter/by-type/work-item/v\*.json** (subtype property)
5. **schemas/frontmatter/schema-map.json** (add bySubtype example)

## Schema Changes

Update `subtype` property in each schema:

```json
{
  "subtype": {
    "oneOf": [
      {
        "type": "string",
        "enum": ["tutorial", "how-to", "reference", "explanation"],
        "description": "Core document subtypes"
      },
      {
        "type": "string",
        "pattern": "^x-[a-z0-9]+(?:-[a-z0-9]+)*$",
        "description": "Custom subtype (x- namespace for extensions)"
      }
    ]
  }
}
```

For work-item:

```json
{
  "subtype": {
    "oneOf": [
      {
        "type": "string",
        "enum": ["story", "task", "bug", "epic", "spike"],
        "description": "Core work-item subtypes"
      },
      {
        "type": "string",
        "pattern": "^x-[a-z0-9]+(?:-[a-z0-9]+)*$",
        "description": "Custom subtype (x- namespace for extensions)"
      }
    ]
  }
}
```

## schema-map.json Updates

Add example bySubtype mappings:

```json
{
  "byType": {
    "document": "./by-type/document/latest.json",
    "work-item": "./by-type/work-item/latest.json"
  },
  "bySubtype": {
    "x-runbook": "./by-subtype/runbook/latest.json",
    "x-rfc": "./by-subtype/rfc/latest.json"
  }
}
```

## Documentation Updates

Add to schemas/README.md:

- Extension pattern: x-{custom-name}
- Rules: lowercase, alphanumeric + hyphens
- How to create custom subtype schema
- Example: creating x-runbook schema structure

## Implementation Notes

- Pattern: `^x-[a-z0-9]+(?:-[a-z0-9]+)*$` ensures valid identifiers
- bySubtype checked before byType in resolver (takes precedence)
- Custom subtype schemas go in by-subtype/{name}/ directory
- Must still extend base schema for compatibility

## Acceptance Criteria

- [ ] Document subtype allows x-\* pattern
- [ ] Work-item subtype allows x-\* pattern
- [ ] schema-map.json shows bySubtype example
- [ ] Pattern validation works (rejects invalid names)
- [ ] ConfigLoader supports bySubtype routing
- [ ] Resolver checks bySubtype before byType
- [ ] Documentation explains extension pattern
- [ ] Example custom subtype schema created

## Testing

- [ ] Schema validates with x-runbook subtype
- [ ] Schema validates with x-custom subtype
- [ ] Schema rejects invalid x- names (e.g., X-capital, x_underscore)
- [ ] Resolver uses bySubtype mapping when available
- [ ] Falls back to byType when no subtype match
- [ ] All core subtypes still work
