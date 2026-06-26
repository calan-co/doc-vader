---
id: wi-60402
title: Graph Viewer Traversal and Path Trace
summary: Add one-hop traversal and path tracing to the standalone graph viewer so reviewers can follow dependencies, records, and scope relationships directly.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: prioritized
priority: high
estimated: 5
links:
  depends_on:
    - '[[60401-graph-viewer-filtering-search-and-metadata-inspection]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-graph-visualization-and-export-prd.md]]'
    - '[[60401-graph-viewer-filtering-search-and-metadata-inspection]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
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

- [ ] Add one-hop incoming and outgoing neighbor expansion from a selected node.
- [ ] Add a focused neighborhood view for selected traversal context.
- [ ] Add path tracing between two selected nodes.
- [ ] Highlight traced paths clearly and return a clear no-path state when
      appropriate.
- [ ] Add focused tests or fixture assertions for traversal and path trace
      behavior.

## Deliverables

- One-hop traversal controls in the standalone viewer.
- Path trace interaction between selected nodes.
- Tests covering traversal, path highlighting, and no-path behavior.

## Acceptance Criteria

- [ ] A reviewer can expand incoming and outgoing neighbors from a selected node.
- [ ] A reviewer can focus the graph on a selected one-hop neighborhood.
- [ ] A reviewer can request a path between two selected nodes when one exists.
- [ ] The viewer reports a clear no-path state when the selected nodes are not
      connected.
- [ ] Traversal does not mutate the underlying graph facts.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60401-graph-viewer-filtering-search-and-metadata-inspection]]

## Relationships

- `depends_on`: `[[60401-graph-viewer-filtering-search-and-metadata-inspection]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-graph-visualization-and-export-prd.md]]`
