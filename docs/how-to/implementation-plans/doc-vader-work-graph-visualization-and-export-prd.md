---
$schema: schemas/work-management/frontmatter/prd.json
$content_schema: schemas/work-management/content/prd.json
$template: templates/reference/work-management/prd.md.tpl
id: plan:doc-vader-work-graph-visualization-and-export-prd
title: doc-vader Work Graph Visualization and Export PRD
summary: Add a summary surface, canonical full-graph export, and a Cytoscape-backed standalone viewer for the projected Work graph.
type: plan
subtype: x-prd
lifecycle: active
status: ready
---

## Artifact Strategy

- Source of truth: `json-payload`
- Rendered views: `markdown`
- Preservation: Store the PRD content JSON sidecar alongside the rendered Markdown and treat JSON as canonical for automation, acceptance review, and future adapter consumers.

## Context Grounding

doc-vader already exposes a read-only projected Work graph through `dv work graph` and `dv wi graph` commands for `nodes`, `edges`, and `inspect`, with JSON and DOT output produced through a context-graph-compatible output extension seam. Graph-backed list, show, readiness, and UAC fixture coverage now exist, but maintainers still lack a canonical whole-graph export contract, a human-readable summary surface, and a first-party visualization tool for filtering, metadata inspection, and traversal over the current projected graph.

### Domain Vocabulary

- work graph

- graph summary

- full graph export

- canonical graph json

- output extension

- cytoscape adapter

- read-only visualization

- stable id

- diagnostics

- node type

- edge type

- provenance

- standalone html viewer

- path trace

- one-hop neighborhood

### ADR Alignment

This PRD follows the entity-governance ADR set: adr-005, adr-006, adr-007, adr-008, adr-009, and adr-010. It also follows the existing Work graph MVP decisions: projection stays read-only, JSON remains the automation contract, DOT remains the renderable graph format, diagnostics stay separate from canonical nodes and edges, and package/core migration is deferred until export and viewer work creates a real pivot signal.

### Source Context

- Conversation-approved AFK direction: maintainer-facing, read-only, canonical full-graph JSON export, Cytoscape first, Graphology deferred behind the adapter seam.

- backlog/60393-read-only-work-graph-explorer-cli.md

- backlog/60394-work-graph-uac-review-fixtures.md

- backlog/60395-graph-backed-work-list-tracer.md

- backlog/60396-graph-backed-work-show-relationships.md

- backlog/60397-derived-readiness-findings-projection.md

- backlog/60398-graph-informed-work-ready-migration.md

- lib/work/graph-explorer.ts

- tests/work-graph-uac-review.test.ts

## Problem Statement

Maintainers can currently inspect graph nodes, graph edges, and a single-node neighborhood, but they still cannot export the whole projected graph through one stable contract or open a first-party visualization that supports filtering, metadata inspection, and traversal. That gap slows review, makes acceptance testing rely on inferred command output, and prevents direct exploration of graph relationships and diagnostics as the graph-backed command surface expands.

## Solution

Add a read-only graph review lane with three complementary surfaces: `summary` for fast human orientation, `export` for canonical full-graph JSON and DOT, and `visualize` for a standalone Cytoscape-backed HTML viewer generated from canonical export JSON. Keep the export JSON as the source-of-truth contract, keep viewer-specific shapes behind an adapter seam, and defer Graphology or native core replacement until visualization/export work proves that a richer in-memory graph model is worth the dependency and migration cost.

## Coverage Model

### Actors

- repository maintainer

- human reviewer

- implementation agent

- automation consumer

### Journey Stages

- summary inspection

- full graph export

- viewer artifact generation

- filtering and search

- relationship traversal

- acceptance review

### Concerns

- read-only safety

- export contract stability

- metadata fidelity

- diagnostics visibility

- low-friction local usage

- maintainable adapter boundaries

### Coverage Notes

- Coverage is intentionally scoped to the current projected Work graph and adjacent runtime/supporting nodes, not a future universal all-entity graph.

- The viewer must consume canonical export JSON rather than redefining graph semantics in a UI-specific shape.

## User Stories

1. As a repository maintainer, I want a default table summary of the projected graph, so that I can quickly understand graph size, type distribution, and diagnostics without parsing raw JSON.
   Covers: repository maintainer / summary inspection / low-friction local usage

2. As an automation consumer, I want a stable full-graph JSON export contract, so that tooling and review workflows can consume the entire projected graph without stitching together separate node and edge commands.
   Covers: automation consumer / full graph export / export contract stability

3. As a human reviewer, I want a renderable DOT export of the whole projected graph, so that I can produce directed graph diagrams from the same canonical facts used by automation.
   Covers: human reviewer / full graph export / metadata fidelity

4. As a repository maintainer, I want a standalone HTML viewer generated from export JSON, so that I can open the graph locally without needing a separate dev server or direct access to repository internals.
   Covers: repository maintainer / viewer artifact generation / low-friction local usage

5. As a human reviewer, I want to filter and search the graph by type and stable identifiers, so that I can isolate the relationships and artifacts relevant to one review question.
   Covers: human reviewer / filtering and search / diagnostics visibility

6. As an implementation agent, I want viewer adapters to preserve stable ids, metadata, and diagnostics exactly, so that UI and test layers do not accidentally redefine the meaning of the projected graph.
   Covers: implementation agent / viewer artifact generation / maintainable adapter boundaries

7. As a repository maintainer, I want traversal tools such as one-hop expansion and path tracing between selected nodes, so that I can validate dependency, record, and scope relationships directly from the rendered graph.
   Covers: repository maintainer / relationship traversal / metadata fidelity

8. As an automation consumer, I want summary, export, and visualization surfaces to remain read-only, so that graph review never creates claims, locks, records, or audit artifacts.
   Covers: automation consumer / acceptance review / read-only safety

## Coverage Review

Status: `complete`

Stories cover the approved AFK MVP surfaces: summary, full export, viewer generation, filtering/search, traversal, and read-only acceptance review.

## Quality Review

- grounding: 5/5
  Rationale: Grounded in current graph explorer commands, existing UAC fixtures, and the user-approved AFK implementation posture.

- coverage: 5/5
  Rationale: The coverage model explicitly spans the summary, export, viewer, traversal, and review lifecycle rather than stopping at command output.

- decision-rationale: 5/5
  Rationale: Key decisions explain why summary, export, and visualization are separate surfaces and why Cytoscape is preferred before core replacement.

- testability: 4/5
  Rationale: Existing CLI and fixture seams make export and review highly testable; viewer interaction will need a new but still deterministic artifact-level seam.

- automation-readiness: 5/5
  Rationale: Canonical JSON remains the interchange source of truth and each AFK work item maps to named UAT scenarios.

The main implementation risk is viewer delivery shape, which is intentionally contained by using a generated standalone HTML artifact rather than a new application platform.

## Implementation Decisions

- Split graph review into `summary`, `export`, and `visualize` surfaces instead of overloading one command with both human and machine defaults.
  Rationale: A human-readable overview and a full-fidelity interchange/export contract solve different jobs and should not blur their output guarantees.

- Add `dv work graph summary` and `dv wi graph summary` with default `table` output and optional `json` output.
  Rationale: This keeps summary behavior consistent with other human-facing report surfaces in the CLI while avoiding lossy table defaults for full export.

- Add `dv work graph export` and `dv wi graph export` with default `json` output and optional `dot` output.
  Rationale: Export is a machine-first and artifact-first contract, so JSON should remain the default while DOT remains available for rendering pipelines.

- Define a new canonical full-graph export JSON contract that includes schema version, graph summary metadata, nodes, edges, and diagnostics, with diagnostics remaining separate from nodes and edges.
  Rationale: The current `nodes` and `edges` command payloads are useful inspection outputs, but a whole-graph contract is needed for viewer generation, acceptance fixtures, and downstream adapters.

- Keep existing `nodes`, `edges`, and `inspect` commands as focused graph inspection surfaces and do not replace them with the new export contract.
  Rationale: Those commands remain valuable for targeted troubleshooting and regression review even after whole-graph export exists.

- Use Cytoscape.js as the first visualization target and defer Graphology until export/viewer work demonstrates a repeated need for a richer in-memory analysis model.
  Rationale: Cytoscape provides the fastest path to local filtering, selection, and traversal, while Graphology is only justified if adapter or analysis pressure grows beyond the current seam.

- Generate a standalone, read-only HTML viewer artifact from canonical export JSON rather than introducing a new dev-server-backed frontend stack.
  Rationale: A standalone artifact keeps local usage friction low, fits the current repository shape, and avoids coupling visualization work to a broader frontend platform decision.

- Translate canonical export JSON into Cytoscape element data through a dedicated adapter seam and keep Cytoscape shapes non-canonical.
  Rationale: This preserves one source-of-truth graph contract and prevents UI library assumptions from leaking back into projection semantics.

- The first viewer capability set includes node-type and edge-type filters, stable-id and label search, metadata inspection, one-hop traversal, and path tracing between selected nodes.
  Rationale: Those are the smallest useful interactions that satisfy the stated need to visualize, filter, and traverse the graph directly.

- Summary, export, and visualization surfaces must remain read-only and must not create claims, locks, records, runtime rows, or audit artifacts.
  Rationale: Graph review is part of the projection lane, not the mutation or runtime-governance lane.

- UAT coverage is part of MVP scope and every acceptance scenario must map to at least one AFK work item.
  Rationale: The immediate value of this slice is direct maintainer review, so acceptance coverage cannot be deferred to a later polish pass.

## Testing Decisions

Validate that graph summary, full export, Cytoscape adapter output, and standalone viewer generation remain read-only while preserving stable node, edge, and diagnostic facts from the current projected Work graph.

### Modules Under Test

- graph summary CLI surface

- full graph export result contract and output extensions

- canonical export JSON to Cytoscape adapter

- standalone HTML viewer renderer

- graph visualization UAT fixtures and review documentation

### Test Seams

- graph summary and export CLI (`end-to-end`): The existing CLI and fixture harness are the highest-confidence seams for validating live projection output and read-only behavior.

- adapter contract (`integration`): The adapter must prove that canonical export JSON maps to Cytoscape elements without losing stable ids, metadata, or diagnostics context.

- viewer artifact generation (`integration`): The viewer should be validated as a generated artifact that consumes export JSON deterministically and can be reviewed without a running app server.

### Prior Art

- Existing `dv work graph` and `dv wi graph` commands for nodes, edges, and inspect.

- The current work graph UAC fixture and snapshots in `tests/work-graph-uac-review.test.ts`.

- Completed graph-backed list, show, readiness, and derived findings slices.

### Validation Gates

- doc-vader prd validate on the PRD content payload

- doc-vader prd render to markdown view

- pnpm run docs:lint

- pnpm run backlog:validate

- Focused Vitest suites for graph export, adapter, and viewer generation

### Seam Review

Status: `confirmed`

The CLI fixture harness already covers graph projection review end-to-end. The new viewer work needs one additional deterministic artifact seam, but it does not require a new application runtime model to become testable.

## Success Criteria

- Maintainers can run a table-first graph summary without parsing raw node or edge JSON.

- Maintainers and automation can export the whole projected graph through one stable JSON contract.

- The same canonical export facts can produce DOT and Cytoscape-compatible visualization output without redefining graph semantics.

- Reviewers can open a standalone HTML artifact and filter, inspect, and traverse the graph locally.

- A documented UAT flow covers summary, export, visualization, traversal, diagnostics visibility, and read-only guarantees.

## Out of Scope

- Replacing the local projection core with Graphology or another community graph core in this slice

- Adding graph mutation, editing, or governance actions to the viewer

- Building a hosted or collaborative multi-user graph viewer service

- Expanding the MVP from the current projected Work graph to a universal all-entity graph

- Introducing GraphQL or remote graph query transport

## Agent Handoff

Ready label: `ready-for-agent`

- Use the approved AFK defaults: maintainer-facing, read-only, canonical full-graph JSON export, Cytoscape first, Graphology deferred behind the adapter seam.

- Treat `summary` as the human-readable surface and `export` as the machine-readable surface; do not collapse them into one default output mode.

- Do not couple the viewer to live projection internals when canonical export JSON can carry the same facts more cleanly.

## Further Notes

- UAT-01: `dv work graph summary` renders a default table with total node count, total edge count, diagnostics count, node-type rollups, and edge-type rollups. Covered by WI-60399.

- UAT-02: `dv work graph export --format json` emits a stable full-graph payload with schema version, summary metadata, nodes, edges, and diagnostics. Covered by WI-60399.

- UAT-03: `dv work graph export --format dot` emits a renderable directed graph covering the same canonical nodes and edges as JSON export. Covered by WI-60399.

- UAT-04: A maintainer can render a standalone HTML viewer artifact from canonical export JSON and open it locally without a dev server. Covered by WI-60400.

- UAT-05: The viewer supports node-type and edge-type filtering plus search by stable id, label, and file path. Covered by WI-60401.

- UAT-06: Selecting a node or edge reveals stable metadata, provenance/source details, and relevant diagnostics context without mutating repository state. Covered by WI-60401.

- UAT-07: The viewer supports one-hop traversal from a selected node and path tracing between two selected nodes when a path exists, with a clear no-path state otherwise. Covered by WI-60402.

- UAT-08: Diagnostics remain separate from canonical nodes and edges but are visible in summary output and in the viewer review surface. Covered by WI-60399 and WI-60401.

- UAT-09: Summary, export, and viewer generation are read-only and do not create claims, locks, records, audit files, or other repository mutations beyond explicit output artifacts. Covered by WI-60399, WI-60400, and WI-60403.

- UAT-10: Viewer data is derived through a dedicated adapter from canonical export JSON rather than a Cytoscape-native canonical shape. Covered by WI-60400.
