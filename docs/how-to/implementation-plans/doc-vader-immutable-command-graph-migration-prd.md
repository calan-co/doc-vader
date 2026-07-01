---
# yaml-language-server: $schema=https://raw.githubusercontent.com/calan-co/doc-vader/main/schemas/work-management/frontmatter/prd.json
"$schema": "https://raw.githubusercontent.com/calan-co/doc-vader/main/schemas/work-management/frontmatter/prd"
"$content_schema": schemas/work-management/content/prd.json
"$template": templates/reference/work-management/prd.md.tpl
"type": plan
"subtype": x-prd
"id": "plan:doc-vader-immutable-command-graph-migration-prd"
"title": "Immutable Command Graph Migration PRD"
"lifecycle": active
"status": ready
"summary": "Add an incremental AFK migration lane for graph-based immutable Work commands while preserving the separation between graph reads and authoritative document/runtime writes."
---

## Artifact Strategy

- Source of truth: `json-payload`
- Rendered views: `markdown`
- Preservation: Store the content JSON sidecar next to the rendered Markdown PRD and treat it as the source of truth for AFK work item generation.

## Context Grounding

doc-vader now has a projected Work graph with formal and informational edge authority, graph explorer/export/viewer surfaces, graph-backed Work list behavior, graph-backed Work show relationship sections, derived readiness findings, and graph-informed Work ready selection. The remaining read-only Work command surfaces still combine canonical document loading, runtime state, git state, and prompt/status rendering without an explicit command-by-command graph parity harness. Mutation and mutation-adjacent flows still use Markdown documents and runtime sqlite as the authoritative write models.

### Domain Vocabulary

- Work graph
- immutable command
- read model
- write model
- formal edge
- informational edge
- authority
- parity harness
- graph-backed prompt
- graph-informed status
- runtime readiness
- canonical Work Item
- projection diagnostics

### ADR Alignment

This PRD follows adr-005 through adr-010: entity facts remain governed, command rendering stays separated from storage concerns, runtime authority remains local git plus sqlite, the Work Item governance kernel remains the readiness/policy boundary, and composable evaluation primitives remain findings rather than ad hoc command behavior. The PRD also preserves the earlier Work graph MVP decision that projection is a read model, not the command write model.

### Source Context

- /tmp/doc-vader-handoff-2026-06-26-work-graph-informational-lane.md
- docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.md
- docs/how-to/implementation-plans/doc-vader-work-graph-visualization-and-export-prd.md
- backlog/60395-graph-backed-work-list-tracer.md
- backlog/60396-graph-backed-work-show-relationships.md
- backlog/60397-derived-readiness-findings-projection.md
- backlog/60398-graph-informed-work-ready-migration.md
- lib/work/list.ts
- lib/task/show.ts
- lib/task/ready.ts
- lib/work/projection.ts
- lib/work/graph-explorer.ts
- tests/task-command.test.ts
- tests/work-list.test.ts
- tests/work-graph-uac-review.test.ts

## Problem Statement

doc-vader maintainers have already proven the graph-backed read model through list, show relationship sections, ready selection, and graph review tools, but the remaining read-only command surfaces do not yet have a durable migration plan or parity harness. Without that plan, agents may either leave prompt/status behavior disconnected from graph facts or overreach by routing mutation-adjacent behavior through projection. The next job is to finish graph-based immutable command migration while preserving the separation between graph reads and authoritative document/runtime writes.

## Solution

Create an incremental AFK migration lane for remaining immutable Work command surfaces. Start with an inventory and parity harness, then migrate prompt relationship context and operational status graph facts in narrow slices, and finish with explicit authority gates that keep formal edges eligible for governance-sensitive behavior while informational edges remain diagnostic/review-only. Mutation commands such as claim, recover, record, lock changes, archive, and lifecycle transitions stay anchored to canonical Markdown and runtime sqlite until a later PRD defines a graph-informed mutation contract.

## Coverage Model

### Actors

- repository maintainer
- implementation agent
- automation consumer
- human reviewer

### Journey Stages

- command inventory
- parity validation
- prompt rendering
- operational status inspection
- authority gating
- AFK handoff

### Concerns

- read-only safety
- output compatibility
- formal-only governance
- informational diagnostics
- runtime/write-model separation
- testable command migration

### Coverage Notes

- The PRD intentionally starts after completed graph-backed list, show relationship, derived readiness, and ready-selection slices.
- The term immutable command means a command whose normal execution should not mutate documents, runtime sqlite, git state, locks, claims, records, or audit artifacts.

## User Stories

1. As a repository maintainer, I want a current inventory of immutable and mutation-adjacent Work commands, so that agents know which command surfaces can safely move to graph-backed reads.
   Covers: repository maintainer / command inventory / read-only safety
2. As an implementation agent, I want a parity harness for immutable command output, so that each migration can prove compatibility before changing default behavior.
   Covers: implementation agent / parity validation / output compatibility
3. As a human reviewer, I want prompt relationship context to come from the same graph facts as show, so that prompt output does not preserve stale or non-governed relationship sections after show has migrated.
   Covers: human reviewer / prompt rendering / testable command migration
4. As a repository maintainer, I want operational status output to include graph-derived relationship and diagnostic facts without making the graph authoritative for runtime state, so that status inspection benefits from projection while preserving local authority.
   Covers: repository maintainer / operational status inspection / runtime/write-model separation
5. As an automation consumer, I want governance-sensitive command behavior to ignore informational edges, so that non-governed references never affect readiness, blocking, claims, locks, or lifecycle decisions.
   Covers: automation consumer / authority gating / formal-only governance
6. As an implementation agent, I want informational references and unresolved projection observations to remain visible as diagnostics, so that typo discovery and graph review improve without changing command semantics.
   Covers: implementation agent / authority gating / informational diagnostics
7. As a human reviewer, I want the AFK work items to be independently grabbable and dependency ordered, so that the migration can continue without another design meeting.
   Covers: human reviewer / AFK handoff / testable command migration

## Coverage Review

Status: `complete`

The stories cover inventory, compatibility, prompt, status, authority gating, diagnostics, and AFK handoff. Mutation command migration is intentionally excluded and represented in out-of-scope rather than left as an implicit gap.

## Quality Review

- grounding: 5/5
  Rationale: The PRD is grounded in the completed graph-backed command slices, the new formal/informational edge authority model, and the current command files and tests.
- coverage: 5/5
  Rationale: The coverage model spans the command discovery, migration, validation, and authority concerns needed for AFK execution.
- decision-rationale: 5/5
  Rationale: Each major boundary explains why graph projection remains a read model and why mutation paths stay on document/runtime authority.
- testability: 4/5
  Rationale: Existing CLI tests and graph UAC fixtures provide strong seams; the first slice still needs to build a reusable parity harness for later command migrations.
- automation-readiness: 5/5
  Rationale: The PRD is JSON-first, maps directly to AFK work items, and names validation gates for documentation, backlog, and command behavior.

The main risk is accidental scope creep into mutation flows. The work items reduce that risk by making boundary classification and formal/informational authority checks explicit before changing prompt or status behavior.

## Implementation Decisions

- Define immutable commands as read-only command executions that do not modify Markdown documents, runtime sqlite rows, git state, claims, locks, records, audit artifacts, or lifecycle state.
  Rationale: The migration needs a deterministic boundary so agents can move read models to graph projection without weakening write-model authority.
  Category: `technical-clarification`
- Keep Markdown Work Items and runtime sqlite as authoritative write models throughout this PRD.
  Rationale: Projection gaps should never corrupt claims, locks, records, recovery, archive behavior, or lifecycle transitions.
  Category: `architecture`
- Require parity tests before switching any immutable command default to graph-backed or graph-informed behavior.
  Rationale: The previous list, show, and ready migrations worked because they preserved output contracts and made intentional differences test-visible.
  Category: `api-contract`
- Migrate prompt relationship context after show because show already proves graph-backed relationship rendering while prompt still uses canonical body sections for execution instructions.
  Rationale: Prompt migration should reuse proven relationship facts but must not change the command's role as an execution-oriented rendering surface.
  Category: `interaction`
- Migrate status as graph-informed, not graph-authoritative.
  Rationale: Status combines runtime readiness, git worktree diagnostics, halted/recoverable state, and dirty-path checks. Graph facts can enrich inspection, but runtime and git remain authoritative for operational state.
  Category: `architecture`
- Only formal edges may influence governance-sensitive command behavior.
  Rationale: Informational edges represent non-governed references and must remain useful for discovery without becoming blockers, readiness inputs, lifecycle checks, or claim/lock inputs.
  Category: `api-contract`
- Expose informational and unresolved observations as diagnostics or review metadata instead of canonical relationship edges.
  Rationale: This improves typo discovery and graph review while preserving the semantic distinction between governed relationships and incidental references.
  Category: `interface`
- Do not migrate claim, recover, record, lock mutation, archive, finalize, or lifecycle transition commands in this PRD.
  Rationale: Those flows are write-model operations and need a separate graph-informed mutation contract if they ever move.
  Category: `module-boundary`

## Testing Decisions

Validate immutable command migration at the CLI and public function seams: command output must remain stable unless an intentional difference is documented in the work item and covered by tests; command execution must remain read-only; formal and informational edge authority must be honored.

### Modules Under Test

- Work command CLI aliases
- canonical Work Item prompt rendering
- operational Work status rendering
- Work graph projection
- graph explorer/export fixtures
- read-only command parity harness

### Test Seams

- CLI command parity (`cli`): The command surface is the public contract consumed by maintainers, agents, and scripts.
  Prior art:
- tests/task-command.test.ts
- tests/work-list.test.ts
- Projection authority filtering (`integration`): Authority behavior crosses projection, command selection, and rendering; it should be tested with realistic Work graph fixtures.
  Prior art:
- tests/work-graph-uac-review.test.ts
- tests/work-graph-visualization.test.ts
- Read-only safety (`end-to-end`): Immutable command migrations must prove they do not create or mutate runtime state, records, locks, or document files.
  Prior art:
- tests/work-graph-uac-review.test.ts

### Prior Art

- Graph-backed Work list tracer
- Graph-backed Work show relationship sections
- Derived readiness findings projection
- Graph-informed Work ready migration
- Work graph UAC review fixture

### Validation Gates

- pnpm run docs:lint
- doc-vader backlog validate --dir backlog --fail-on error
- pnpm run backlog:validate:ci
- pnpm exec vitest run tests/task-command.test.ts tests/work-list.test.ts tests/work-graph-uac-review.test.ts

### Seam Review

Status: `confirmed`

The highest useful seam is the CLI for user-visible behavior, backed by projection integration fixtures for authority filtering and read-only safety.

## Success Criteria

- Every remaining read-only Work command is classified as graph-backed, graph-informed, deferred, or out-of-scope with a reason.
- Prompt relationship context uses graph facts where appropriate while preserving execution-oriented body rendering.
- Status output can report graph facts and diagnostics without making projection authoritative for runtime or git state.
- Formal edge authority is enforced wherever command behavior could affect governance-sensitive interpretation.
- Informational edges remain visible for review but do not affect readiness, blocking, lifecycle, claims, locks, or mutations.
- AFK work items validate with documentation and backlog gates.

## Out of Scope

- Migrating claim, recover, record, lock mutation, archive, finalize, or lifecycle transition commands to graph-backed write behavior.
- Changing branch protection, CI required checks, local hooks, secrets, collaborator permissions, or workflow triggers.
- Replacing the current local projection engine with an external semantic graph dependency.
- Making informational references blockers or governance relationships.
- Changing Work Item schema status policy or lifecycle transition rules.

## Agent Handoff

Ready label: `ready-for-agent`

- Start with the inventory/parity work item before migrating prompt or status.
- Use completed list/show/ready slices as patterns, not as work to repeat.
- Treat graph projection as a read model and documents plus runtime sqlite as write models.
- Keep mutation command boundaries explicit in tests and work item acceptance criteria.

## Relationships

- x-references: `work-item:60395` Note: Completed low-risk graph-backed read migration.
- x-references: `work-item:60396` Note: Completed graph-backed relationship rendering pattern.
- x-references: `work-item:60398` Note: Completed governance-sensitive graph-informed read migration.
- x-references: `plan:doc-vader-work-graph-visualization-and-export-prd` Note: Current graph export and review contract.

## Further Notes

- The handoff recommended graph-backed show, list, ready, relationship, explorer, and reporting surfaces in that order. The live repository shows list, show relationships, ready, summary, export, and visualization already completed or present, so this PRD begins with the remaining read-only command surfaces instead of recreating completed work.
- If a later implementation finds another immutable command surface beyond prompt and status, add it to the inventory and either classify it as a new AFK slice or document why it is deferred.
