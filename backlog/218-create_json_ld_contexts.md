---
id: "218"
type: work-item
subtype: task
lifecycle: active
status: proposed
title: Create Reusable JSON-LD Vocabulary Contexts
description: |
  Create reusable JSON-LD context files for vocabulary mapping.
  Support Dublin Core, Schema.org, and custom vocabularies.
  Store in contexts/ directory for reference in .doc.json configuration.
summary: JSON-LD context definitions for vocabulary mapping
owner: ~
audience: [developers]
governance: technical-decision
tags: [json-ld, vocabulary, contexts]
estimated: 3
links:
  depends_on:
    - "[[217-update_schemas_for_json_ld]]"
---

## Files to Create

1. **contexts/dublin-core.context.json** - DC terms
2. **contexts/schema-org.context.json** - Schema.org mappings
3. **contexts/work-item.context.json** - Work item specific
4. **contexts/document.context.json** - Document specific
5. **contexts/base.context.json** - Default base context

## contexts/dublin-core.context.json

```json
{
  "@context": {
    "@version": 1.1,
    "dc": "http://purl.org/dc/terms/",
    "title": "dc:title",
    "description": "dc:description",
    "created": { "@id": "dc:created", "@type": "xsd:dateTime" },
    "modified": { "@id": "dc:modified", "@type": "xsd:dateTime" },
    "creator": "dc:creator",
    "subject": "dc:subject",
    "audience": "dc:audience"
  }
}
```

## contexts/work-item.context.json

```json
{
  "@context": {
    "@version": 1.1,
    "@vocab": "https://schema.org/",
    "wi": "http://example.org/work-item#",
    "dc": "http://purl.org/dc/terms/",
    "xsd": "http://www.w3.org/2001/XMLSchema#",

    "id": "wi:identifier",
    "type": "@type",
    "title": "name",
    "priority": "wi:priority",
    "estimated": { "@id": "wi:estimatedEffort", "@type": "xsd:duration" },
    "assignee": "wi:assignee",
    "tags": "keywords",
    "created": { "@id": "dc:created", "@type": "xsd:dateTime" }
  }
}
```

## contexts/document.context.json

```json
{
  "@context": {
    "@version": 1.1,
    "@vocab": "https://schema.org/",
    "dc": "http://purl.org/dc/terms/",
    "xsd": "http://www.w3.org/2001/XMLSchema#",

    "id": "identifier",
    "title": "name",
    "summary": "description",
    "owner": "author",
    "tags": "keywords",
    "created": { "@id": "dc:created", "@type": "xsd:dateTime" },
    "modified": { "@id": "dc:modified", "@type": "xsd:dateTime" }
  }
}
```

## contexts/base.context.json

Minimal base context for default fallback:

```json
{
  "@context": {
    "@version": 1.1,
    "@vocab": "https://schema.org/"
  }
}
```

## Implementation Notes

- Use `@version: 1.1` for JSON-LD 1.1 features
- Include `@vocab` to set default vocabulary
- Use full URIs for property definitions
- Include type coercion for dates, durations
- Document which vocabulary each context represents

## Acceptance Criteria

- [ ] dublin-core.context.json created with DC terms
- [ ] schema-org.context.json references Schema.org
- [ ] work-item.context.json maps work-item fields
- [ ] document.context.json maps document fields
- [ ] base.context.json provides fallback
- [ ] All contexts use valid JSON-LD syntax
- [ ] All contexts stored in contexts/ directory
- [ ] Documented with examples

## Usage Examples

In frontmatter:

```yaml
"@context": "./contexts/work-item.context.json"
id: wi-123
title: Task
```

Or inline:

```yaml
"@context":
  dc: "http://purl.org/dc/terms/"
dc:creator: John Doe
```
