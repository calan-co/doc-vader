---
id: wi-60400
title: Cytoscape Adapter and Standalone Graph Viewer Artifact
summary: Generate a read-only standalone HTML viewer from canonical full-graph export JSON using a dedicated Cytoscape adapter seam.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: prioritized
priority: high
estimated: 5
links:
  depends_on:
    - '[[60399-graph-summary-and-full-export-command-surface]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-graph-visualization-and-export-prd.md]]'
    - '[[60399-graph-summary-and-full-export-command-surface]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
tags:
  - afk
  - graph
  - visualization
  - adapter
  - cytoscape
---

## Goal

Turn canonical full-graph export JSON into a standalone HTML viewer artifact so
maintainers can open the projected graph locally without a dev server or direct
coupling to projection internals.

## Background

The accepted architecture keeps canonical export JSON as the source-of-truth
interchange contract and treats viewer-specific shapes as adapter outputs.
Cytoscape is the first visualization target because it delivers the fastest path
to local graph exploration while keeping Graphology deferred until a stronger
analysis need appears.

This slice covers UAT-04, UAT-09, and UAT-10.

## What to build

Add a dedicated adapter from canonical full-graph export JSON into Cytoscape
elements plus a command that renders a standalone, read-only HTML artifact from
an export JSON file. Keep the viewer self-contained and ensure Cytoscape data
shapes do not become canonical graph contract shapes.

## Tasks

- [ ] Define an adapter boundary from canonical export JSON to Cytoscape
      elements.
- [ ] Preserve stable ids, labels, source/provenance metadata, and diagnostics
      context through the adapter.
- [ ] Add a read-only `dv work graph visualize` / `dv wi graph visualize`
      command that accepts canonical export JSON input and writes a standalone
      HTML artifact.
- [ ] Keep the HTML artifact self-contained enough to open locally without a
      running app server.
- [ ] Ensure the viewer artifact does not reproject the repository or mutate any
      runtime/governance state.
- [ ] Add focused tests for adapter fidelity, artifact generation, and read-only
      behavior.

## Deliverables

- Canonical export JSON to Cytoscape adapter.
- Standalone HTML viewer artifact generation command.
- Tests proving adapter fidelity and read-only artifact generation.

## Acceptance Criteria

- [ ] Canonical export JSON can be translated into Cytoscape elements without
      losing stable ids or metadata.
- [ ] `dv work graph visualize` can generate a standalone HTML artifact from
      export JSON.
- [ ] The generated viewer opens locally without a dedicated app server.
- [ ] Cytoscape-specific element shapes remain non-canonical and live behind the
      adapter seam.
- [ ] Viewer generation is read-only and does not create claims, locks, records,
      audit files, or repository edits beyond the explicit output artifact.
- [ ] Validation passes with `pnpm run docs:lint`.
- [ ] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60399-graph-summary-and-full-export-command-surface]]

## Relationships

- `depends_on`: `[[60399-graph-summary-and-full-export-command-surface]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-graph-visualization-and-export-prd.md]]`
