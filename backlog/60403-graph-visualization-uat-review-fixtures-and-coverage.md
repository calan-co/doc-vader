---
id: wi-60403
title: Graph Visualization UAT Review Fixtures and Coverage
summary: Extend the graph review fixture path so summary, export, visualization, and traversal can be reviewed deterministically against the accepted UAT scenarios.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: medium
estimated: 4
completed_date: '2026-06-26'
commits:
  45c355eed796dd174f97fc52ef97225842da25f6: 'feat(work): merge sandcastle work graph updates'
links:
  depends_on:
    - '[[60399-graph-summary-and-full-export-command-surface]]'
    - '[[60400-cytoscape-adapter-and-standalone-graph-viewer-artifact]]'
    - '[[60401-graph-viewer-filtering-search-and-metadata-inspection]]'
    - '[[60402-graph-viewer-traversal-and-path-trace]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-graph-visualization-and-export-prd.md]]'
    - '[[60394-work-graph-uac-review-fixtures]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
  evidence:
    - '[[record-20260701-032943-60403]]'
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/74
tags:
  - afk
  - graph
  - uat
  - visualization
  - review
---

## Goal

Make graph summary, full export, visualization, and traversal reviewable through
one deterministic UAT fixture path rather than ad hoc local experimentation.

## Notes

- 2026-06-30: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.

## Background

The current Work graph UAC fixture covers `nodes`, `edges`, and `inspect`.
This PRD expands the acceptance surface to summary, whole-graph export,
standalone viewer generation, filtering, search, metadata inspection, and path
tracing. That review path needs explicit coverage so AFK implementation can be
accepted against one stable checklist.

This slice covers UAT-01 through UAT-10 and is the final acceptance-review
guardrail for the feature.

## What to build

Extend or add fixture-backed review commands, expected outputs, and
documentation that cover summary, export, viewer generation, and viewer review
steps. The review flow should prove read-only behavior, preserve canonical graph
facts, and make it easy for a maintainer to validate each accepted UAT
scenario, including the no-argument browser-open path plus stdin, inline, file,
stdout, and deterministic file-backed visualization transport modes.

## Tasks

- [x] Expand the existing Work graph UAC fixture or add a dedicated
      visualization fixture with stable expected outputs for summary and full
      export.
- [x] Add fixture-backed review coverage for standalone viewer artifact
      generation.
- [x] Cover visualization transport variants for live projection defaults,
      canonical export file input, stdin input, inline JSON input, stdout
      output, explicit file output, and temporary browser-opened artifacts.
- [x] Add a deterministic reviewer checklist that maps each UAT scenario to one
      or more commands or review actions.
- [x] Add automated tests or snapshot assertions where practical for summary,
      export, adapter fidelity, artifact generation, and read-only behavior.
- [x] Document any viewer interactions that remain manual review rather than
      automated assertions.
- [x] Ensure the UAT flow remains read-only except for explicit output artifacts
      such as exported JSON, DOT, or generated HTML.

## Deliverables

- Fixture-backed UAT path for graph summary, export, and visualization.
- Reviewer checklist covering UAT-01 through UAT-10.
- Automated or snapshot coverage for stable summary/export/viewer artifact
  outputs.
- Transport coverage for the common no-argument viewer path and optional input
  and output modes.
- Explicit note about any remaining manual viewer review steps.

## Acceptance Criteria

- [x] A reviewer can run one documented fixture-backed flow to validate summary,
      export, and visualization behavior.
- [x] The review path maps every accepted UAT scenario to explicit evidence.
- [x] Fixture outputs prove read-only behavior for graph review commands and
      viewer generation.
- [x] Automated assertions exist for every stable artifact contract that can be
      checked non-interactively.
- [x] The review path proves `visualize` can consume live projection, file,
      stdin, and inline canonical payload sources and emit stdout, durable file,
      or temporary browser-opened artifacts.
- [x] Any manual-only viewer interactions are explicitly documented rather than
      implied.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60399-graph-summary-and-full-export-command-surface]]
- [[60400-cytoscape-adapter-and-standalone-graph-viewer-artifact]]
- [[60401-graph-viewer-filtering-search-and-metadata-inspection]]
- [[60402-graph-viewer-traversal-and-path-trace]]

## Relationships

- `depends_on`: `[[60399-graph-summary-and-full-export-command-surface]]`
- `depends_on`: `[[60400-cytoscape-adapter-and-standalone-graph-viewer-artifact]]`
- `depends_on`: `[[60401-graph-viewer-filtering-search-and-metadata-inspection]]`
- `depends_on`: `[[60402-graph-viewer-traversal-and-path-trace]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-graph-visualization-and-export-prd.md]]`
