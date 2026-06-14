---
id: wi-221
title: Add Schema Test Fixtures
summary: Test fixture files for schema validation
type: work-item
subtype: task
lifecycle: active
status: closed
priority: medium
estimated: 3
links:
  evidence:
    - '[[record-20260518-124800-221]]'
    - '[[record-20260612-hitl-221]]'
    - '[[record-20260612-backlog-consolidation]]'
  reference:
    - '[[60333-canonical-schema-profile-routing-and-fixtures]]'
tags:
  - schemas
  - testing
  - fixtures
  - hitl
governance:
  profiles:
    - testing
status_reason: obsolete
actual: 0
completed_date: '2026-06-12'
---

## Directory Structure

```bash tree
schemas/frontmatter/by-type/document/
├── current.json
├── v1.0.0.json
└── test-cases/
    ├── valid/
    │   ├── minimal.yaml
    │   ├── complete.yaml
    │   ├── with-json-ld.yaml
    │   └── custom-subtype.yaml
    └── invalid/
        ├── missing-required.yaml
        ├── bad-status.yaml
        └── invalid-lifecycle.yaml

schemas/frontmatter/by-type/work-item/
├── current.json
├── v1.0.0.json
└── test-cases/
    ├── valid/
    │   ├── minimal.yaml
    │   ├── task.yaml
    │   ├── epic.yaml
    │   ├── with-json-ld.yaml
    │   └── custom-subtype.yaml
    └── invalid/
        ├── missing-priority.yaml
        ├── missing-estimated.yaml
        ├── bad-priority.yaml
        └── invalid-status-transition.yaml
```

## Sample Files

### test-cases/valid/minimal.yaml (document)

```yaml
id: doc-001
type: document
subtype: tutorial
title: Minimal Valid Document
lifecycle: active
status: ready
```

### test-cases/valid/with-json-ld.yaml (document)

```yaml
"@context": "./contexts/dublin-core.context.json"
"@type": ["CreativeWork", "Document"]
id: doc-002
type: document
subtype: reference
title: Document with Vocabulary Mapping
lifecycle: active
status: ready
dc:creator: Jane Doe
dc:subject: [metadata, json-ld]
```

### test-cases/valid/custom-subtype.yaml (work-item)

```yaml
id: wi-custom-001
type: work-item
subtype: x-runbook
title: Emergency Response Runbook
lifecycle: active
status: ready
priority: high
estimated: 8
```

### test-cases/invalid/missing-required.yaml

```yaml
id: doc-bad-001
type: document
# Missing title - required
lifecycle: active
status: ready
```

### test-cases/invalid/bad-status.yaml

```yaml
id: wi-bad-001
type: work-item
subtype: task
title: Invalid Status
lifecycle: active
status: invalid-status # Not in enum
priority: high
estimated: 5
```

## Files to Create

Create test-cases for:

1. Document schema (valid + invalid)
2. Work-item schema (valid + invalid)
3. Custom subtype example (if created)

## Acceptance Criteria

- [ ] test-cases/ directory structure created
- [ ] At least 3 valid test cases per schema type
- [ ] At least 3 invalid test cases per schema type
- [ ] All test cases are valid YAML
- [ ] Valid cases pass schema validation
- [ ] Invalid cases fail schema validation with specific errors
- [ ] Test cases document different features (JSON-LD, subtypes, etc.)
- [ ] Documented in schemas/README.md

## Integration with Testing

Optional (future):

- Add test runner to CI/CD
- Run schema validation against test-cases
- Report coverage of schema features

## Supersession Note

- 2026-06-12: Closed as obsolete because this work is superseded by [[60333-canonical-schema-profile-routing-and-fixtures]]. Evidence: [[record-20260612-backlog-consolidation]]; audit reference: [[backlog/audit/auditing-backlog-report]].
