---
id: "216"
type: work-item
subtype: task
lifecycle: active
status: in-progress
title: Document Minimal Schema Requirements (schemas/README.md)
description: |
  Create comprehensive documentation for creating doc-vader-compatible schemas.
  Include minimal requirements, optional features, examples, and validation checklist.
  Serve as reference for users creating custom schema types.
summary: Schema requirements documentation and examples
priority: medium
audience: [developers, schema-authors]
governance:
  profiles: [documentation]
tags: [schemas, documentation, guide]
estimated: 3
links:
  depends_on:
    - "[[211-fix_jsonschema_tools_compatibility]]"
    - "[[215-update_validation_to_use_resolver]]"
commits:
  00a8da0: "feat(work-management): add canonical foundation package"
---

## Files to Create

1. **schemas/README.md** - Main documentation
2. **schemas/examples/minimal-schema.json** - Working minimal example
3. **schemas/examples/feature-complete-schema.json** - Full-featured example

## schemas/README.md Contents

1. **Minimal Schema Requirements**
   - Required schema metadata ($schema, $id, title, description)
   - Required frontmatter fields (via base schema extension)
   - Directory structure (by-type/custom-type/{current.json, latest.json, v\*.json})

2. **Required Frontmatter Fields**
   - List of 6 core fields (id, title, type, subtype, lifecycle, status)
   - Explanation of each field
   - Reference to support/base schema

3. **Optional Features**
   - Extension tokens (x-\* pattern)
   - Custom properties
   - JSON-LD support (@context/@type)
   - State machine rules

4. **Integration Points**
   - How tools use schemas (audit, frontmatter-lint, remark plugins)
   - What validation rules are enforced
   - Links to implementation

5. **Examples**
   - Minimal valid schema
   - Custom type extension
   - With JSON-LD support

6. **Validation Checklist**
   - Extends base schema correctly
   - Proper metadata
   - Directory structure
   - For extension schemas (x-\* support)

## Example: Minimal Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://raw.githubusercontent.com/templjs/templ.js/main/schemas/frontmatter/by-type/custom-type/v1.0.0.json",
  "title": "frontmatter/custom-type",
  "type": "object",
  "unevaluatedProperties": false,
  "allOf": [
    { "$ref": "base#/$defs/core" },
    { "$ref": "base#/$defs/lifecycleStatusCompatibility" },
    {
      "type": "object",
      "properties": {
        "type": { "const": "custom-type" },
        "id": { "pattern": "^ct-\\d+$" },
        "@context": {
          "description": "JSON-LD context per spec"
        },
        "@type": {
          "description": "JSON-LD type per spec"
        }
      }
    }
  ]
}
```

## Acceptance Criteria

- [ ] schemas/README.md complete with all sections
- [ ] Minimal example schema valid and working
- [ ] Feature-complete example demonstrates all options
- [ ] Checklist is clear and actionable
- [ ] Examples are in schemas/examples/
- [x] Cross-links to other docs
- [ ] Reviewed for clarity and accuracy

## Notes

- 2026-03-11: Commit `00a8da0` started this task by adding [`docs/reference/work-management/overview.md`](../docs/reference/work-management/overview.md), [`docs/reference/work-management/foundation.md`](../docs/reference/work-management/foundation.md), and the greenfield pet-store example set under `docs/reference/work-management/examples/`.
- 2026-03-11: The new work-management package also landed the companion schemas in `schemas/work-management/` and templates in `templates/reference/work-management/`, which gives this task a concrete working example set to fold into `schemas/README.md` and `schemas/examples/`.
- 2026-03-11: Remaining scope is to consolidate that material into the planned `schemas/README.md` and `schemas/examples/*` deliverables after the resolver/config dependencies settle.
