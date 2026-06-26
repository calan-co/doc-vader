---
id: wi-60399
title: Graph Summary and Full Export Command Surface
summary: Add separate summary and full export commands for the projected Work graph with human-first and machine-first defaults.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: prioritized
priority: high
estimated: 5
links:
  depends_on:
    - '[[60393-read-only-work-graph-explorer-cli]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-graph-visualization-and-export-prd.md]]'
    - '[[60393-read-only-work-graph-explorer-cli]]'
    - '[[60394-work-graph-uac-review-fixtures]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
tags:
  - afk
  - cli
  - graph
  - export
  - uat
---

## Goal

Add a clean graph review command split where maintainers can get a human-readable
summary quickly and export the full projected Work graph through one stable
machine-readable contract.

## Background

`dv work graph` and `dv wi graph` already support `nodes`, `edges`, and
`inspect`, with JSON and DOT output provided through the context-graph-compatible
output extension seam. The remaining gap is a whole-graph surface: there is no
default summary for fast human review and no canonical full-graph export command
for downstream tooling or visualization.

This slice covers UAT-01, UAT-02, UAT-03, UAT-08, and part of UAT-09.

## What to build

Add `dv work graph summary` / `dv wi graph summary` and `dv work graph export` /
`dv wi graph export`. Summary should default to a table-like human-readable
format and optionally support JSON. Export should default to JSON and optionally
support DOT. The full export JSON contract must include stable schema version,
graph summary metadata, nodes, edges, and diagnostics while keeping diagnostics
separate from canonical nodes and edges.

## Tasks

- [ ] Add `summary` subcommands for `dv work graph` and `dv wi graph`.
- [ ] Add `export` subcommands for `dv work graph` and `dv wi graph`.
- [ ] Make summary default to human-readable table output and support `--format json`.
- [ ] Make export default to `--format json` and support `--format dot`.
- [ ] Define and document a stable full-graph export JSON contract with summary
      metadata, nodes, edges, and diagnostics.
- [ ] Keep JSON and DOT rendering behind the graph output extension seam rather
      than command-local serializers.
- [ ] Preserve existing `nodes`, `edges`, and `inspect` commands.
- [ ] Add focused tests for summary output, full export JSON, full export DOT,
      diagnostics visibility, and read-only behavior.

## Deliverables

- `summary` graph review command surface with human-first default output.
- `export` graph command surface with stable canonical JSON and DOT outputs.
- A documented full-graph export contract.
- Tests covering summary, export, diagnostics, and read-only behavior.

## Acceptance Criteria

- [ ] `dv work graph summary` renders a human-readable table by default.
- [ ] `dv work graph summary --format json` returns the same summary facts as
      structured JSON.
- [ ] `dv work graph export --format json` returns the whole projected graph with
      schema version, summary metadata, nodes, edges, and diagnostics.
- [ ] `dv work graph export --format dot` produces valid directed graph syntax
      suitable for Graphviz rendering.
- [ ] Diagnostics remain separate from canonical nodes and edges in export JSON.
- [ ] Existing `nodes`, `edges`, and `inspect` commands still work.
- [ ] The command surface is read-only and does not create claims, locks,
      records, or audit artifacts.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60393-read-only-work-graph-explorer-cli]]

## Relationships

- `depends_on`: `[[60393-read-only-work-graph-explorer-cli]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-graph-visualization-and-export-prd.md]]`
