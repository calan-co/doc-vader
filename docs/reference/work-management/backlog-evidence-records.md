---
id: backloga-64
title: Backlog Evidence Records
type: document
subtype: reference
lifecycle: active
status: ready
tags:
  - backlog-automation
  - evidence-generation
  - records
links:
  reference:
    - '[[backlog-scan-cli.md]]'
    - '[[../../guide/backlog-automation-configuration.md]]'
---

# Backlog Evidence Records

Backlog scan can optionally create evidence records when a work item is resolved and `--generate-evidence` is enabled.

## Record Format

Evidence records are written to `backlog/records/` as markdown files.

- Filename: `record-YYYYMMDD-HHMMSS-{work-item-slug}.md`
- Frontmatter:
  - `type: record`
  - `subtype: evidence`
  - `id: record:YYYYMMDD-HHMMSS-{work-item-slug}`

Example:

```yaml
---
id: record:20260513-022530-175
title: Backlog scan evidence for work-item:175
summary: Backlog scan evidence for work-item:175
type: record
subtype: evidence
lifecycle: active
status: ready
status_reason: recorded
---
```

## Linking Behavior

When a record is created, the source work item is linked via `links.evidence` using a wikilink:

- `[[record-YYYYMMDD-HHMMSS-{work-item-slug}]]`

## Idempotency

`backlog scan --generate-evidence` is idempotent for a given work item:

- If an evidence link already exists on the work item, no additional record is created.
- Re-running scan does not append duplicate evidence links.

## CLI Usage

```bash
# Generate evidence records during scan
pnpm exec doc-vader backlog scan --generate-evidence --report-format json

# Preview without writing
pnpm exec doc-vader backlog scan --generate-evidence --dry-run --report-format json
```

## Report Metadata

Each scanned item includes evidence generation metadata:

- `created`: whether a new record was created
- `recordIds`: record identifiers involved
- `linkedAt`: ISO timestamp when linking occurred (when applicable)
- `errors`: any record/linking errors
