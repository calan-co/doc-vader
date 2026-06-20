---
$schema: /frontmatter/document
id: adrentity-5819
title: Adopt entity governance as the Doc-Vader architecture identity
type: document
subtype: generic
status: ready
lifecycle: active
tags:
  - adr
  - architecture
  - entity-governance
links:
  reference:
    - '[[../../how-to/implementation-plans/doc-vader-entity-governance-architecture-prd.md]]'
    - '[[../../project-brief.md]]'
    - '[[../registry-model.md]]'
    - '[[adr-009-storage-and-format-seams.md]]'
---

## Context and Problem Statement

Doc-Vader began as documentation automation, backlog hygiene, and workflow
guardrails for Markdown projects. The current roadmap now includes governed work
items, records, runtime claims, locks, execution logs, manifests, policies,
provider events, projections, lineage, package authoring, and hosted authority.

If the architecture remains framed as document or backlog automation, each new
artifact family becomes an exception. The system needs one vocabulary that works
for built-in entities and future package-authored entities.

## Decision

Doc-Vader is an entity governance runtime.

Documents, work items, records, tasks, runtime claims, locks, execution logs,
manifests, reports, projections, and lineage artifacts are modeled as governed
entities or supporting artifacts under one primitive model.

Core primitives:

- `Artifact`: schema-backed persisted unit.
- `Entity`: artifact with durable identity plus lifecycle or state.
- `Record`: append-only supporting artifact linked to governed entities.
- `Node`, `Edge`, and `Resolution`: registry graph primitives.
- `Subject`: governed target of an event, decision, evidence item, or policy.
- `Policy`: composed constraints evaluated over entities and artifacts.
- `Gate`: fail-closed decision point with machine-readable diagnostics.
- `Manifest`: immutable decision/input bundle.
- `Claim`, `Lock`, and `Execution Log`: runtime coordination entities.
- `Scope`: bounded authority surface for execution and mutation.
- `Projection` and `Lineage`: derived evidence artifacts, not replacements for
  source artifacts.
- `Package`: extension bundle that contributes entity definitions, policies,
  commands, schemas, templates, and validation behavior.
- `Storage Adapter`: medium-specific persistence for governed artifacts and
  runtime entities.
- `Format Adapter`: format-specific parsing, serialization, and
  canonicalization.

## Decision Drivers

- Consumers need one mental model across docs, backlog, runtime, and hosted
  workflows.
- Package authors need stable extension seams that do not depend on current
  built-in entity names.
- Entity semantics must not be coupled to Markdown, JSON, SQLite, or a specific
  file layout.
- Validation, state management, audit, and policy behavior must be reusable
  across default and custom entities.
- Current PRDs and backlog items already depend on primitives that are broader
  than documentation linting.

## Consequences

Positive:

- Built-in document and work-management behavior becomes the standard package,
  not a special architecture exception.
- Runtime work around claims, locks, and execution logs has a stable place in the
  model.
- Future package authors can target entity governance seams instead of copying
  work-item-specific behavior.

Negative/Risks:

- Existing docs and CLI names still expose historical `backlog`, `work-item`, and
  `task` surfaces.
- Some older backlog items must be reconciled because they encode narrower
  scope-graph or single-agent assumptions.

## Validation

- Architecture and PRD artifacts use entity governance language.
- New package-authoring work references entity primitives instead of
  work-item-only abstractions.
- Backlog prioritization treats runtime entity foundation as the current
  implementation spine.
