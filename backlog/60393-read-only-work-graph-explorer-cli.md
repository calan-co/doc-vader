---
id: wi-60393
title: Read-Only Work Graph Explorer CLI
summary: Add dv work graph and dv wi graph inspection commands with JSON and DOT output.
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
    - '[[60392-live-repository-graph-projection-robustness]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
tags:
  - afk
  - cli
  - graph
  - work-management
---

## Goal

Expose a direct, read-only Work graph inspection surface so maintainers can
review projected graph facts without editing files or inferring graph state from
other command output.

## Background

The PRD separates read-only projection from command mutation. Before migrating
existing non-mutating Work commands to graph-backed reads, maintainers need a
small CLI surface that can show projected nodes, edges, and a single-node
neighborhood in machine-readable and visualizable formats.

The command must use `dv work graph` and `dv wi graph`. Do not add a separate
`digraph` alias.

The JSON and DOT output implementations should be context-graph-compatible
output extensions behind the local projection port. The CLI should select an
extension and stream its output rather than owning graph serialization logic.

## What to build

Add a read-only Work graph explorer with subcommands for nodes, edges, and node
inspection. Support JSON output for automation and Graphviz DOT output for
rendering directed graphs. Implement those formats as output extensions shaped
for later native `context-graph` adoption. Provide filtering by node type, edge
type, source node, target node, and one-node neighborhood where the projection
model supports it.

## Tasks

- [x] Add `dv work graph` and `dv wi graph` command entry points.
- [x] Add `nodes`, `edges`, and `inspect <node-id>` graph explorer subcommands.
- [x] Add `--format json` and `--format dot`; make JSON the default if that
      matches local CLI conventions.
- [x] Implement JSON and DOT formatting behind a context-graph-compatible
      output extension seam instead of CLI-local serializers.
- [x] Reject or omit a `digraph` format or alias.
- [x] Add filters for node type, edge type, source node, target node, and
      one-node neighborhood.
- [x] Include projection diagnostics from live repository projection in JSON
      output without making them graph nodes.
- [x] Ensure the command is read-only and cannot create claims, locks, records,
      audit files, or repository edits.
- [x] Add integration tests for JSON output, DOT output, filters, and
      diagnostics.

## Deliverables

- `dv work graph` and `dv wi graph` read-only CLI commands.
- JSON graph explorer output extension contract.
- Graphviz DOT output extension contract.
- Tests covering command aliases, filters, and output formats.

## Acceptance Criteria

- [x] `dv work graph nodes --format json` returns stable projected node data.
- [x] `dv wi graph edges --format json` returns stable projected edge data.
- [x] `dv wi graph inspect <node-id> --format json` returns the node and its
      one-node relationship neighborhood.
- [x] DOT output is valid Graphviz directed graph syntax and can be piped to a
      file or rendering command.
- [x] JSON and DOT output are produced through context-graph-compatible
      extension implementations, not command-local serialization branches.
- [x] The explorer supports JSON and DOT only; no `digraph` alias is added.
- [x] Projection diagnostics are visible to users without becoming graph edges
      or nodes.
- [x] The explorer does not mutate repository, runtime, record, or audit state.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `pnpm run backlog:validate`.

## Blocked by

- [[60392-live-repository-graph-projection-robustness]]

## Relationships

- `depends_on`: `[[60392-live-repository-graph-projection-robustness]]`
- `implements`: `[[../docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md]]`
