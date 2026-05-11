---
id: workmanagement-1
title: Canonical Work-Management Foundation
type: document
subtype: reference
lifecycle: active
status: ready
links:
  reference:
    - '[[foundation.md]]'
    - '[[backlog-scan-cli.md]]'
    - '[[../../guide/backlog-automation-configuration.md]]'
    - '[[../../architecture/decisions/adr-002-vendor-adapter-pattern.md]]'
    - '[[../../architecture/decisions/adr-003-multi-strategy-subject-resolution.md]]'
    - '[[../../architecture/decisions/adr-004-backlog-scan-lifecycle.md]]'
---

## Summary

This package defines a Markdown-first, `templjs`-aligned foundation for work
management. Authored Markdown remains the canonical source. Template
frontmatter declares the schema contracts used for authoring, validation, and
autocomplete. Extracted JSON graph files are compiled outputs for machine use.

## Primary Types

| Type        | Responsibility                                             | Typical subtype examples                                       |
| ----------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| `project`   | Durable initiative boundary and success model              | `initiative`, `program`                                        |
| `release`   | Shippable boundary with readiness gates and included scope | `launch`, `incremental`, `hotfix`                              |
| `milestone` | Concrete capability, date, or decision target              | `capability`, `date-gate`, `decision-gate`                     |
| `work-item` | Executable unit of work with decomposition and dependency  | `epic`, `feature`, `story`, `task`, `bug`, `spike`             |
| `plan`      | Overlay artifact for planning perspective and sequencing   | `strategic`, `operational`, `tactical`, `contingency`          |
| `record`    | Append-only audit trail artifact                           | `evidence`, `test-result`, `comment`, `approval`, `audit-note` |

## Work-Item Contract

`work-item` is the only primary type that carries closure-gating traceability in
frontmatter. In v1 it requires:

- `priority`
- `estimated`
- optional `actual`
- optional `commits`
- optional `links.pull_requests`
- optional `links.evidence`
- optional `links.reference`

When a work item is `closed`, `actual`, `commits`, `links.pull_requests`, and
`links.evidence` are all required.

The authored execution semantics stay in content:

- `goal`
- optional `background`
- `tasks`
- optional `deliverables`
- `acceptanceCriteria`
- `relationships`
- optional annex families such as `design`, `examples`, `testing`,
  `operations`, `scope`, and `analysis`
- optional `notes`

## Correlation Fields

The foundation does not model portfolio or product as first-class authored
entities in v1. Instead, primary entities can carry lightweight correlation
fields that support filtering and later domain promotion:

- `portfolio`
- `product`
- `component`
- `target_start_date`
- `target_end_date`
- `target_start_period`
- `target_end_period`

Classification correlation fields use normalized tokens such as `doc-vader`.
Coarse planning periods use normalized tokens such as `2027-Q1`. Exact dates
stay in separate ISO date fields. `product` requires `portfolio`, `component`
requires both `product` and `portfolio`, and each `target_*` endpoint may use
an exact date or a planning period, but not both.

## Template-Declared Contract

Each `templjs` template declares the authoring contract in template frontmatter:

- `type` or `$types`
- optional `subtype` or `$subtypes`
- `$schema` for the authored-instance frontmatter
- `$content_schema` for extracted semantic content

The template metadata is the authoritative mapping source. Any manifest or
index is derived from template metadata and should not be hand-authored.

## Relationship Policy

Semantic relationships are authored once, in one direction only.

- `part_of`
- `depends_on`
- `targets`
- `includes`
- `subjectRefs`

Reverse navigation is derived in tooling and never written manually into the
source Markdown. Supporting `links` in frontmatter remain available for
non-semantic references and traceability metadata such as PR and evidence
links.

## Schema.org Mapping

Use schema.org as a vocabulary anchor and extend locally where the core model
does not describe the domain cleanly.

| Primary type | Base mapping                                          | Notes                                                        |
| ------------ | ----------------------------------------------------- | ------------------------------------------------------------ |
| `project`    | `schema:Project`                                      | Durable initiative boundary                                  |
| `release`    | `schema:CreativeWork` + `dv:Release`                  | Release as an authored management artifact                   |
| `milestone`  | `schema:Intangible` + `dv:Milestone`                  | Target and gate semantics come from local extensions         |
| `work-item`  | `schema:Action` + `dv:WorkItem`                       | Executable tracked unit of work                              |
| `plan`       | `schema:CreativeWork` + `schema:ItemList` + `dv:Plan` | Planning overlay rather than the work itself                 |
| `record`     | `schema:CreativeWork` + `dv:Record`                   | Specific subtypes may map to narrower schema.org types later |

## Canonical Example Set

The greenfield pet-store set provides one authored file per entity:

- [`project-pet-store-website.md`](./examples/greenfield-pet-store/project-pet-store-website.md)
- [`release-pet-store-launch-01.md`](./examples/greenfield-pet-store/release-pet-store-launch-01.md)
- [`milestone-pet-store-checkout-ready.md`](./examples/greenfield-pet-store/milestone-pet-store-checkout-ready.md)
- [`work-item-pet-100.md`](./examples/greenfield-pet-store/work-item-pet-100.md)
- [`work-item-pet-110.md`](./examples/greenfield-pet-store/work-item-pet-110.md)
- [`work-item-pet-120.md`](./examples/greenfield-pet-store/work-item-pet-120.md)
- [`plan-pet-store-strategy.md`](./examples/greenfield-pet-store/plan-pet-store-strategy.md)
- [`record-pet-store-launch-dry-run.md`](./examples/greenfield-pet-store/record-pet-store-launch-dry-run.md)

The compiled machine view is:

- [`greenfield-pet-store-website.graph.json`](./examples/greenfield-pet-store-website.graph.json)

## Working Defaults

1. Keep Markdown as the authored source of truth.
2. Keep semantic edges in extracted content, not in frontmatter `links`.
3. Keep reverse edges derived, never duplicated.
4. Keep secondary PM concepts as correlation fields until they earn first-class
   lifecycle of their own.

## Backlog Automation and Evidence Generation

The doc-vader backlog automation system enables automated evidence capture when workflow runs complete. This system:

- **Listens for trigger events**: Workflow completion, PR merge, automation hooks
- **Resolves work-item subjects**: Uses configurable strategy chain to extract work-item identifiers from event metadata
- **Creates evidence records**: Appends audit trail records linking workflows to work items
- **Reports structured results**: Generates JSON/text reports with decision visibility

### Evidence Records

Evidence records (`type: record, subtype: evidence`) capture automation decisions and outcomes:

```yaml
type: record
subtype: evidence
id: record-20260507-143000-175
relatedWorkItem: work-item:175
sourceEvent:
  type: workflow_run
  eventId: 25519076107
  timestamp: 2026-05-07T14:30:00Z
resolutionStrategy: linked_pull_requests
conditions:
  pr_link_found: true
  pr_merged: true
  workflow_succeeded: true
  subject_resolved: true
linkedAt: 2026-05-07T14:30:05Z
```

### Configuration

Enable backlog automation in `.doc-vader/backlog-consumer.json`:

```json
{
  "metadata": {
    "consumer": "org/repo"
  },
  "automation": {
    "autoEvidenceFromWorkflowRuns": true,
    "subjectResolutionOrder": ["payload_subject_tokens", "linked_pull_requests"]
  }
}
```

### CLI Commands

Scan backlog and generate reports:

```bash
# Report only (no side effects)
doc-vader backlog scan --report-format json

# Generate evidence records
doc-vader backlog scan --generate-evidence --report-format json

# Custom resolver order
doc-vader backlog scan --resolver-order payload_subject_tokens
```

### Subject Resolution

The resolver chain uses multiple strategies to find work-item identifiers:

1. **`payload_subject_tokens`**: Fast (~1ms); extracts from PR/workflow metadata
2. **`linked_pull_requests`**: Comprehensive (~200-500ms); fetches PR metadata via API
3. **`audit_pr_subject_index`**: Lookup (~10ms); queries historical associations
4. **`provider_associated_pull_requests`**: Vendor-specific; delegates to provider API

Configure resolver order to balance speed vs. comprehensiveness.

### Documentation

- [Backlog Automation Configuration Guide](../../guide/backlog-automation-configuration.md): Configuration options and examples
- [Backlog Scan CLI Reference](./backlog-scan-cli.md): Command syntax and options
- [Resolver Strategy Guide](./resolver-strategy-guide.md): Details on each strategy
- [Troubleshooting Guide](./backlog-automation-troubleshooting.md): Debugging and resolution

### Architecture Decisions

- [ADR-002: Vendor Adapter Pattern](../../architecture/decisions/adr-002-vendor-adapter-pattern.md)
- [ADR-003: Multi-Strategy Subject Resolution](../../architecture/decisions/adr-003-multi-strategy-subject-resolution.md)
- [ADR-004: Backlog Scan Lifecycle](../../architecture/decisions/adr-004-backlog-scan-lifecycle.md)
