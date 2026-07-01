---
id: wi-60400
title: Cytoscape Adapter and Standalone Graph Viewer Artifact
summary: Generate a read-only standalone HTML viewer from canonical full-graph export JSON using a dedicated Cytoscape adapter seam.
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
    - '[[60399-graph-summary-and-full-export-command-surface]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-graph-visualization-and-export-prd.md]]'
    - '[[60399-graph-summary-and-full-export-command-surface]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
  evidence:
    - '[[record-20260701-032943-60400]]'
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/74
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
either the current projected graph or canonical export JSON supplied through
stdin, inline payloads, or a file. Keep the viewer self-contained, make the
common path a no-argument browser-open flow, and ensure Cytoscape data shapes
do not become canonical graph contract shapes.

## Tasks

- [x] Define an adapter boundary from canonical export JSON to Cytoscape
      elements.
- [x] Preserve stable ids, labels, source/provenance metadata, and diagnostics
      context through the adapter.
- [x] Add a read-only `dv work graph visualize` / `dv wi graph visualize`
      command that defaults to the current projected graph and also accepts
      canonical export JSON via stdin, inline payloads, or a file.
- [x] Make `--output` optional, with stdout and explicit file support plus a
      temporary browser-opened artifact when omitted.
- [x] Keep the HTML artifact self-contained enough to open locally without a
      running app server.
- [x] Ensure the viewer artifact does not reproject the repository or mutate any
      runtime/governance state.
- [x] Add focused tests for adapter fidelity, artifact generation, and read-only
      behavior.

## Deliverables

- Canonical export JSON to Cytoscape adapter.
- Standalone HTML viewer artifact generation command.
- Visualization transport behavior for live projection, stdin, inline JSON,
  file input, stdout, explicit files, and temporary browser-opened artifacts.
- Tests proving adapter fidelity and read-only artifact generation.

## Acceptance Criteria

- [x] Canonical export JSON can be translated into Cytoscape elements without
      losing stable ids or metadata.
- [x] `dv work graph visualize` can generate a standalone HTML artifact from the
      current projected graph with no required flags.
- [x] `dv work graph visualize --input <json-file|inline-json|->` can generate
      the same viewer from canonical export JSON supplied through supported
      transport inputs.
- [x] The generated viewer opens locally without a dedicated app server.
- [x] `dv work graph visualize --output -` writes HTML to stdout and
      `--output <path>` writes a durable artifact without requiring a browser
      launch.
- [x] Cytoscape-specific element shapes remain non-canonical and live behind the
      adapter seam.
- [x] Viewer generation is read-only and does not create claims, locks, records,
      audit files, or repository edits beyond the explicit output artifact.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60399-graph-summary-and-full-export-command-surface]]

## Relationships

- `depends_on`: `[[60399-graph-summary-and-full-export-command-surface]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-graph-visualization-and-export-prd.md]]`
