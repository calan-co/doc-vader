---
id: wi-60401
title: Graph Viewer Filtering, Search, and Metadata Inspection
summary: "Add the first maintainer-facing interactive review features to the standalone graph viewer: filtering, search, and metadata inspection."
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
completed_date: '2026-06-26'
priority: high
estimated: 5
links:
  depends_on:
    - '[[60400-cytoscape-adapter-and-standalone-graph-viewer-artifact]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-graph-visualization-and-export-prd.md]]'
    - '[[60400-cytoscape-adapter-and-standalone-graph-viewer-artifact]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
tags:
  - afk
  - graph
  - visualization
  - filtering
  - uat
---

## Goal

Make the standalone graph viewer useful for real review by adding direct
filtering, search, and metadata inspection against the canonical exported graph.

## Background

A rendered graph is not enough if maintainers still need to inspect raw JSON to
answer review questions. The first useful review interaction set is filtering by
type, searching by stable identity or human-facing labels, and inspecting the
selected node or edge in detail along with diagnostics context.

This slice covers UAT-05, UAT-06, and part of UAT-08.

## What to build

Extend the standalone viewer with node-type and edge-type filters, search by
stable id, label, and file path, and an inspection panel that shows selected
node or edge metadata plus relevant diagnostics context without changing the
underlying graph.

## Tasks

- [x] Add node-type and edge-type filters to the viewer.
- [x] Add search by stable id, label, and source file path.
- [x] Add selection and inspection panels for nodes and edges.
- [x] Surface stable metadata such as ids, labels, source/provenance, and graph
      properties in the inspection panel.
- [x] Surface diagnostics context in the viewer without representing diagnostics
      as canonical graph nodes or edges.
- [x] Add focused tests or deterministic fixture assertions for filtering,
      search, selection, metadata display, and diagnostics visibility.

## Deliverables

- Interactive viewer filters for node and edge types.
- Viewer search for stable ids, labels, and file paths.
- Node and edge inspection panels with metadata and diagnostics context.
- Tests covering interactive review behavior at the artifact seam.

## Acceptance Criteria

- [x] A reviewer can filter visible nodes and edges by type.
- [x] A reviewer can search by stable id, label, and source file path.
- [x] Selecting a node or edge reveals stable metadata and source/provenance
      details.
- [x] Diagnostics are visible in the viewer without becoming canonical graph
      nodes or edges.
- [x] The viewer remains read-only.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60400-cytoscape-adapter-and-standalone-graph-viewer-artifact]]

## Relationships

- `depends_on`: `[[60400-cytoscape-adapter-and-standalone-graph-viewer-artifact]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-graph-visualization-and-export-prd.md]]`
