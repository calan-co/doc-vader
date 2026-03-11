---
id: workmanagement-2
title: Work-Management Foundation Package
type: document
subtype: reference
lifecycle: draft
status: proposed
links:
  parent:
    - "[[overview.md]]"
---

## Type Catalog

| Type | Purpose | Common subtypes | Authored artifact | Extracted artifact |
| --- | --- | --- | --- | --- |
| `project` | Initiative boundary and success model | `initiative`, `program` | Markdown instance | extracted project node |
| `release` | Release boundary with gates and included scope | `launch`, `incremental`, `hotfix` | Markdown instance | extracted release node |
| `milestone` | Target capability or gating objective | `capability`, `date-gate`, `decision-gate` | Markdown instance | extracted milestone node |
| `work-item` | Executable work unit | `epic`, `feature`, `story`, `task`, `bug`, `spike` | Markdown instance | extracted work-item node |
| `plan` | Planning overlay | `strategic`, `operational`, `tactical`, `contingency` | Markdown instance | extracted plan node |
| `record` | Audit trail artifact | `evidence`, `test-result`, `comment`, `approval`, `audit-note` | Markdown instance | extracted record node |

## Schema Package

### Frontmatter Schemas

- [`schemas/work-management/frontmatter/project.json`](../../../schemas/work-management/frontmatter/project.json)
- [`schemas/work-management/frontmatter/release.json`](../../../schemas/work-management/frontmatter/release.json)
- [`schemas/work-management/frontmatter/milestone.json`](../../../schemas/work-management/frontmatter/milestone.json)
- [`schemas/work-management/frontmatter/work-item.json`](../../../schemas/work-management/frontmatter/work-item.json)
- [`schemas/work-management/frontmatter/plan.json`](../../../schemas/work-management/frontmatter/plan.json)
- [`schemas/work-management/frontmatter/record.json`](../../../schemas/work-management/frontmatter/record.json)

### Content Schemas

- [`schemas/work-management/content/project.json`](../../../schemas/work-management/content/project.json)
- [`schemas/work-management/content/release.json`](../../../schemas/work-management/content/release.json)
- [`schemas/work-management/content/milestone.json`](../../../schemas/work-management/content/milestone.json)
- [`schemas/work-management/content/work-item.json`](../../../schemas/work-management/content/work-item.json)
- [`schemas/work-management/content/plan.json`](../../../schemas/work-management/content/plan.json)
- [`schemas/work-management/content/record.json`](../../../schemas/work-management/content/record.json)

### Shared Support

- [`schemas/work-management/support/common.json`](../../../schemas/work-management/support/common.json)
- [`schemas/work-management/template-metadata.json`](../../../schemas/work-management/template-metadata.json)

## Work-Item Structure

`work-item` is the only v1 primary type with status-aware closure metadata in
frontmatter. The frontmatter schema now covers:

- `priority`
- `estimated`
- optional `actual`
- optional `commits`
- optional `links.pull_requests`
- optional `links.evidence`
- optional `links.reference`

Its content schema follows the `templjs` backlog structure:

- `goal`
- optional `background`
- `tasks`
- optional `deliverables`
- `acceptanceCriteria`
- `relationships`
- optional annex families: `design`, `examples`, `testing`, `operations`,
  `scope`, `analysis`
- optional `notes`

## Template Package

- [`templates/reference/work-management/project.tpl.md`](../../../templates/reference/work-management/project.tpl.md)
- [`templates/reference/work-management/release.tpl.md`](../../../templates/reference/work-management/release.tpl.md)
- [`templates/reference/work-management/milestone.tpl.md`](../../../templates/reference/work-management/milestone.tpl.md)
- [`templates/reference/work-management/work-item.tpl.md`](../../../templates/reference/work-management/work-item.tpl.md)
- [`templates/reference/work-management/plan.tpl.md`](../../../templates/reference/work-management/plan.tpl.md)
- [`templates/reference/work-management/record.tpl.md`](../../../templates/reference/work-management/record.tpl.md)

Each template declares:

- `type` or `$types`
- optional `subtype` or `$subtypes`
- `$schema`
- `$content_schema`

No template contract beyond those fields is part of v1.

## Canonical Example Set

The pet-store example set is intentionally small but complete enough to show:

- one file per primary type
- correlation fields on primary entities
- unidirectional authored relationships
- compiled graph output with derived reverse edges

Authored examples:

- [`project-pet-store-website.md`](./examples/greenfield-pet-store/project-pet-store-website.md)
- [`release-pet-store-launch-01.md`](./examples/greenfield-pet-store/release-pet-store-launch-01.md)
- [`milestone-pet-store-checkout-ready.md`](./examples/greenfield-pet-store/milestone-pet-store-checkout-ready.md)
- [`work-item-pet-100.md`](./examples/greenfield-pet-store/work-item-pet-100.md)
- [`work-item-pet-110.md`](./examples/greenfield-pet-store/work-item-pet-110.md)
- [`work-item-pet-120.md`](./examples/greenfield-pet-store/work-item-pet-120.md)
- [`plan-pet-store-strategy.md`](./examples/greenfield-pet-store/plan-pet-store-strategy.md)
- [`record-pet-store-launch-dry-run.md`](./examples/greenfield-pet-store/record-pet-store-launch-dry-run.md)

Compiled output:

- [`greenfield-pet-store-website.graph.json`](./examples/greenfield-pet-store-website.graph.json)

## Extraction Contract

1. Template frontmatter declares the frontmatter schema and content schema used
   for authored instances.
2. Authored instance frontmatter carries metadata, state, supporting links, and
   correlation fields.
3. Markdown sections carry the narrative and structured information that is
   extracted into the content object.
4. Compiled graph output combines frontmatter and content per entity, then adds
   derived reverse edges for analysis and traversal.
