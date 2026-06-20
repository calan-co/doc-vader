---
$schema: schemas/work-management/frontmatter/prd.json
$content_schema: schemas/work-management/content/prd.json
$template: templates/reference/work-management/prd.md.tpl
id: plan:doc-vader-entity-governance-architecture-prd
title: Doc-Vader Entity Governance Architecture PRD
summary: Align Doc-Vader around entity governance, Work Item kernel extraction, and the local runtime entity spine.
type: plan
subtype: x-prd
lifecycle: active
status: ready
tags:
  - architecture
  - entity-governance
  - runtime
---

## Artifact Strategy

- Source of truth: `json-payload`
- Rendered views: `markdown`
- Preservation: Store this content JSON sidecar next to the rendered Markdown PRD
  and treat JSON as canonical for automation.

## Context Grounding

Doc-Vader already has documentation validation, backlog hygiene, work-item
mutation, record creation, governance profiles, task commands, and an active
runtime backlog around claims, locks, execution logs, and extension authoring.
Architecture exploration found that these capabilities should be unified as
entity governance rather than extended as separate document, backlog, and task
silos.

### Domain Vocabulary

- entity governance
- artifact
- entity
- record
- Work Item
- Task projection
- Work Item Governance Kernel
- runtime entity
- claim
- lock
- execution log
- gate
- policy
- manifest
- package
- storage adapter
- format adapter

### ADR Alignment

This PRD is aligned with ADR-005 through ADR-009. ADR-001 remains the validation
substrate decision; ADR-002 through ADR-004 remain the provider, resolver, and
scan decisions.

### Source Context

- Architecture review found Work Item governance rules duplicated across
  work-management, task, scan, lint, and plugin modules.
- Backlog review identified 60361 as the current local runtime authority
  contract.
- Challenge pass decided that Work Item remains canonical and Task is the
  command projection.
- The stale backlog implementation plan should be replaced by a runtime and
  entity-governance roadmap.

## Problem Statement

Doc-Vader's active roadmap has outgrown its historical framing as documentation
automation and backlog hygiene. Without an entity-governance architecture,
consumers get inconsistent task, backlog, scan, and lint behavior, while package
authors lack stable primitives for extending the system.

## Solution

Adopt entity governance as the top-level product architecture. Define built-in
document and work-management packages, promote Work Item governance into a deep
kernel, adopt Git plus SQLite as the local runtime authority, and prioritize the
runtime entity spine before hosted SaaS, artifact graph, archive pruning, and
prototype recovery. Define storage and format seams in MVP so entity semantics
are not coupled to Markdown, JSON, SQLite, or file layout.

## Coverage Model

### Actors

- human consumer
- AI consumer
- package author
- repository maintainer
- runtime command author

### Journey Stages

- entity definition
- validation and linting
- ready selection
- runtime coordination
- evidence and audit
- extension authoring

### Concerns

- daily usability
- consistent governance answers
- package adoption
- fail-closed safety
- schema-first evolution
- runtime locality

### Coverage Notes

The PRD aligns architecture and backlog direction; it does not implement the
kernel or runtime store directly.

## User Stories

1. As a human consumer, I want task and backlog commands to return the same
   readiness answer, so that I do not have to learn which command is
   authoritative.
   Covers: human consumer / ready selection / daily usability
2. As an AI consumer, I want machine-readable verdicts for readiness, policy,
   dependencies, and evidence, so that automation can fail closed without
   guessing.
   Covers: AI consumer / runtime coordination / fail-closed safety
3. As a package author, I want stable entity primitives and extension seams, so
   that I can add custom governed entities without copying Work Item internals.
   Covers: package author / extension authoring / package adoption
4. As a repository maintainer, I want runtime claims, locks, and execution logs
   to use one local authority, so that multi-agent work is coordinated and
   auditable.
   Covers: repository maintainer / runtime coordination / runtime locality
5. As a package author, I want storage and format adapters to be separate seams,
   so that custom entities can choose file, JSON, SQLite, or future hosted
   backing without rewriting governance rules.
   Covers: package author / entity definition / package adoption

## Coverage Review

Status: `complete`

Stories cover the two primary audiences plus maintainers and runtime command
authors.

## Quality Review

- grounding: 5/5
  Rationale: Grounded in current code exploration, ADRs, PRDs, and active
  backlog.
- coverage: 4/5
  Rationale: Covers core architecture alignment; hosted SaaS and artifact graph
  remain deferred.
- decision-rationale: 5/5
  Rationale: Durable decisions are captured in ADRs with explicit tradeoffs.
- testability: 4/5
  Rationale: Kernel and runtime seams are testable, but implementation remains
  future work.
- automation-readiness: 5/5
  Rationale: The PRD uses JSON source and names machine-readable verdicts as a
  success path.

This is an architecture-alignment PRD, not a feature implementation PRD.

## Implementation Decisions

- Adopt entity governance as the top-level architecture identity.
  Rationale: The active roadmap spans documents, work items, runtime entities,
  policy, manifests, and package authoring.
  Category: `architecture`
- Keep Work Item canonical and Task as the command projection.
  Rationale: This preserves existing schema artifacts while keeping agent command
  UX ergonomic.
  Category: `interface`
- Use Git plus SQLite as the local runtime authority for the MVP.
  Rationale: It supports atomic local multi-agent coordination without
  prematurely adopting hosted authority.
  Category: `architecture`
- Define storage and format seams in MVP while implementing only minimal
  adapters.
  Rationale: The architecture needs to separate entity semantics from Markdown,
  JSON, SQLite, and file layout before core modules harden.
  Category: `architecture`
- Prioritize the Work Item Governance Kernel before widening task command
  behavior.
  Rationale: Shared verdicts prevent scan, lint, task, and work-management drift.
  Category: `architecture`

## Testing Decisions

The architecture is valid when one kernel can produce shared Work Item
governance verdicts and the runtime spine can coordinate claims, locks, and
execution logs through SQLite-backed tests.

### Modules Under Test

- Work Item Governance Kernel
- storage adapters
- format adapters
- runtime entity schemas
- SQLite runtime store
- task command adapter
- backlog scan adapter
- remark validation adapter

### Test Seams

- Kernel verdict seam (`integration`): Task, scan, lint, and work-management
  behavior should share the same governance answer.
- Runtime authority seam (`integration`): Claims, locks, and execution logs must
  be proven transactionally.
- Storage/format adapter seam (`integration`): Markdown/YAML, JSON, and SQLite
  adapters must produce canonical records that governance modules can consume
  without storage-specific knowledge.

### Prior Art

- Existing work-management tests
- Existing task command tests
- Existing backlog scan tests
- Existing schema routing tests

### Validation Gates

- pnpm run docs:lint
- pnpm run backlog:validate:ci

### Seam Review

Status: `ready`

The next implementation slice should create kernel and runtime tests before
widening commands.

## Success Criteria

- Architecture docs name entity governance as the top-level identity.
- Backlog roadmap prioritizes the runtime entity spine.
- Work Item governance extraction is tracked as an explicit work item.
- Storage and format adapter seams are tracked as MVP architecture.
- Deferred hosted, artifact graph, archive, and prototype recovery lanes are
  named.

## Out of Scope

- Implementing the Work Item Governance Kernel.
- Implementing SQLite runtime storage.
- Designing hosted SaaS authority.
- Designing section-level artifact claims.
