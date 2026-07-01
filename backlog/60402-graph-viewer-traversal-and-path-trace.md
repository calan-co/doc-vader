---
id: wi-60402
title: Graph Viewer Traversal and Path Trace
summary: Add one-hop traversal and path tracing to the standalone graph viewer so reviewers can follow dependencies, records, and scope relationships directly.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 5
completed_date: '2026-06-26'
commits:
  45c355eed796dd174f97fc52ef97225842da25f6: 'feat(work): merge sandcastle work graph updates'
links:
  depends_on:
    - '[[60401-graph-viewer-filtering-search-and-metadata-inspection]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-graph-visualization-and-export-prd.md]]'
    - '[[60401-graph-viewer-filtering-search-and-metadata-inspection]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
  evidence:
    - '[[record-20260701-032943-60402]]'
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/74
tags:
  - afk
  - graph
  - visualization
  - traversal
  - uat
---

## Goal

Let maintainers traverse the graph directly from the viewer instead of inferring
relationship chains from isolated node or edge inspection.

## Background

The immediate need is not only to render the graph but to traverse it. Reviewers
need to move from one node to its neighbors and trace paths between two
identified nodes when validating dependency, record, and scope relationships.

This slice covers UAT-07.

## What to build

Add interactive one-hop traversal and path tracing to the standalone viewer.
Reviewers should be able to expand incoming and outgoing neighbors from a
selected node, focus the graph on that neighborhood, and request a path between
two selected nodes with clear handling when no path exists.

## Tasks

- [x] Add one-hop incoming and outgoing neighbor expansion from a selected node.
- [x] Add a focused neighborhood view for selected traversal context.
- [x] Add path tracing between two selected nodes.
- [x] Highlight traced paths clearly and return a clear no-path state when
      appropriate.
- [x] Add focused tests or fixture assertions for traversal and path trace
      behavior.

## Deliverables

- One-hop traversal controls in the standalone viewer.
- Path trace interaction between selected nodes.
- Tests covering traversal, path highlighting, and no-path behavior.

## Acceptance Criteria

- [x] A reviewer can expand incoming and outgoing neighbors from a selected node.
- [x] A reviewer can focus the graph on a selected one-hop neighborhood.
- [x] A reviewer can request a path between two selected nodes when one exists.
- [x] The viewer reports a clear no-path state when the selected nodes are not
      connected.
- [x] Traversal does not mutate the underlying graph facts.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60401-graph-viewer-filtering-search-and-metadata-inspection]]

## Relationships

- `depends_on`: `[[60401-graph-viewer-filtering-search-and-metadata-inspection]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-graph-visualization-and-export-prd.md]]`
