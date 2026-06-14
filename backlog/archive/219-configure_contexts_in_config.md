---
id: wi-219
title: Configure Vocabulary Contexts in .doc.json
summary: Vocabulary context configuration in .doc.json
type: work-item
subtype: task
lifecycle: active
status: closed
priority: low
estimated: 2
links:
  evidence:
    - '[[record-20260518-124800-219]]'
    - '[[record-20260612-hitl-219]]'
    - '[[record-20260612-backlog-consolidation]]'
  reference:
    - '[[60333-canonical-schema-profile-routing-and-fixtures]]'
tags:
  - config
  - json-ld
  - vocabulary
  - hitl
governance:
  profiles:
    - technical-decision
status_reason: obsolete
actual: 0
completed_date: '2026-06-12'
---

## Files to Create/Update

1. **.doc.base.json** - Create (or update if exists)
2. **.doc.json** - Create (or update if exists)

## .doc.base.json

```json
{
  "schemaDir": "./schemas",
  "schemaMap": {
    "default": "frontmatter/by-type/document/latest.json",
    "byType": {
      "document": "frontmatter/by-type/document/latest.json",
      "work-item": "frontmatter/by-type/work-item/latest.json"
    }
  },
  "validation": {
    "strict": false,
    "allErrors": true,
    "validateSchema": false
  },
  "backlog": {
    "dir": "./backlog",
    "format": "text",
    "failOn": "error",
    "includeArchive": false
  },
  "vocabularies": {
    "contexts": {
      "work-item": "./contexts/work-item.context.json",
      "document": "./contexts/document.context.json",
      "dc": "./contexts/dublin-core.context.json",
      "schema": "./contexts/schema-org.context.json"
    },
    "defaultContext": "./contexts/base.context.json"
  }
}
```

## .doc.json

```json
{
  "extends": "./.doc.base.json",
  "backlog": {
    "failOn": "warning"
  }
}
```

## .doc.ci.json (Example CI Config)

```json
{
  "extends": "./.doc.json",
  "backlog": {
    "format": "json",
    "failOn": "warning"
  },
  "validation": {
    "strict": true,
    "allErrors": true
  }
}
```

## Configuration Structure

```typescript
vocabularies: {
  // Named contexts available to schemas
  contexts: {
    "work-item": path,
    "document": path,
    "dc": path,
    "schema": path
  },
  // Fallback when no type-specific context
  defaultContext: path
}
```

## Resolution Precedence

1. Inline `@context` in frontmatter (highest)
2. Type/subtype-specific context from `config.vocabularies.contexts`
3. Default context from `config.vocabularies.defaultContext`

## Implementation Notes

- Paths relative to .doc.json location
- Contexts can be URLs (for remote contexts) or local paths
- Use `loadDocVaderConfig()` to load configs in code
- Update frontmatter resolver to use vocabularies config

## Acceptance Criteria

- [ ] .doc.base.json created with vocabularies section
- [ ] .doc.json extends .doc.base.json
- [ ] Example .doc.ci.json shows overrides
- [ ] All contexts in config point to created files
- [ ] ConfigLoader correctly loads vocabularies config
- [ ] Variables interpolation works (if needed)
- [ ] Documentation explains precedence

## Testing

- [ ] Load .doc.json successfully
- [ ] vocabularies.contexts available in config
- [ ] defaultContext available
- [ ] resolveVocabularyContext() uses precedence
- [ ] Inline context overrides config context
- [ ] Config context used when inline absent
- [ ] Default context used as fallback

## Supersession Note

- 2026-06-12: Closed as obsolete because this work is superseded by [[60333-canonical-schema-profile-routing-and-fixtures]]. Evidence: [[record-20260612-backlog-consolidation]]; audit reference: [[backlog/audit/auditing-backlog-report]].
