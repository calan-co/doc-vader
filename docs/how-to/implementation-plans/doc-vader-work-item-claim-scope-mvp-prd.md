---
$schema: schemas/work-management/frontmatter/prd.json
$content_schema: schemas/work-management/content/prd.json
$template: templates/reference/work-management/prd.md.tpl
id: plan:doc-vader-work-item-claim-scope-mvp-prd
title: Doc-Vader Work Item Claim Scope MVP PRD
summary: Define the narrow Work, Claim, and Scope MVP for graph-informed runtime governance.
type: plan
subtype: x-prd
lifecycle: active
status: ready
tags:
  - architecture
  - runtime
  - claims
  - scopes
  - artifact-graph
---

## Artifact Strategy

- Source of truth: `json-payload`
- Rendered views: `markdown`
- Preservation: Store this JSON payload next to the rendered Markdown PRD and treat the JSON as canonical for automation.

## Context Grounding

Doc-Vader already has schema-backed Work Items, a legacy Task command projection over the Work family, a Work Item Governance Kernel, evaluation primitives, Git plus SQLite runtime authority, runtime claims, locks, execution logs, and changed-file lock audits. Architecture review found that the next useful MVP should not widen the whole extension model; it should prove a narrow artifact graph, scope, and command lifecycle slice across Work, Work Item, and Claim entities.

### Domain Vocabulary

- Artifact Graph Projection

- Projection Catalog

- Work

- Work Item

- Task

- Work command surface

- Task projection

- Claim

- Claim lease

- Claim scope

- ScopeRef

- URI ScopeRef

- Entity type specifier

- Lock Policy

- read scope

- write scope

- execute scope

- Scope node

- authored edge direction

- depends_on edge

- belongs_to edge

- implements edge

- locks edge

- records edge

- Work graph explorer

- DOT graph output

- context-graph output extension

- Derived readiness finding

- graph-backed list

- graph-backed ready

- Runtime Authority

- Storage Adapter

- Format Adapter

- Check

- Finding

- Review Profile

- Gate

- Record

- Package

- context-graph

- Semantify

### ADR Alignment

Aligned with ADR-005 entity governance, ADR-007 Git plus SQLite local runtime authority, ADR-008 Work Item Governance Kernel, ADR-009 storage and format seams, and ADR-010 composable evaluation primitives. It refines ADR-006 by keeping Work Item canonical while renaming the family-wide Task command projection to a Work command surface. This PRD narrows those decisions into a Work + Claim + Scope MVP and does not reopen hosted authority, package registry, or full graph database decisions.

### Source Context

- Conversation decision: Doc-Vader should be graph-backed, with read-only projection separated from command mutation.

- Conversation decision: commands are graph-informed, but mutate authoritative storage through entity-specific command modules.

- Conversation decision: claim identity is immutable; renewal is permitted only when associated scopes remain available.

- Conversation decision: scope targets must use canonical ScopeRef identity, not storage adapter identity.

- Conversation decision: canonical authored edge direction follows assertion ownership; reverse traversal is a query/view concern, not a second authored truth.

- Conversation decision: the MVP needs an operator-facing read-only graph explorer before graph-backed command migration can be reviewed.

- Conversation decision: the graph explorer should support JSON and DOT output, with no separate digraph alias.

- Conversation decision: graph explorer output formats should be implemented as context-graph-compatible output extensions behind the local projection port so JSON and DOT can migrate to native context-graph without rewriting CLI behavior.

- Conversation decision: existing non-mutating Work commands should migrate incrementally to graph-backed behavior, starting with list, then relationship sections in show, then readiness findings and ready selection.

- Code review evidence: backlog/60343 records renewal only on explicit claim-context mutation commands and read-only touch updates last_seen_at without extending expires_at.

- Code review evidence: lib/runtime/sqlite-store.ts renews active claims when runtime lock acquisition mutates claim context.

- Architecture report top recommendation: deepen the Work Item corpus before widening package extensibility.

## Problem Statement

Doc-Vader has enough runtime and governance primitives to coordinate local multi-agent Work Item execution, but the current model still treats claim scope, graph projection, storage location, command mutation, and command naming as partially coupled concerns. The existing dv task surface operates on the whole Work family even though Task is only one Work Item subtype. Without a narrow Work + Claim + Scope MVP, implementers will either overbuild generic extensibility or keep duplicating policy across the legacy Task command projection, runtime, scan, and validation paths.

## Solution

Define a narrow MVP that treats Work as the family/domain term, keeps Work Item as the schema-backed member artifact, reserves Task for one Work Item subtype, projects Work Items, Claims, Claim leases, Claim scopes, Records, changed artifacts, and authored relationship edges into a canonical artifact graph, uses URI-formatted ScopeRef targets for read/write/execute scopes, enforces scope availability through atomic lock policies before command mutation, renews claims only when associated scopes remain available, and verifies mutations by reprojecting graph state after authoritative storage changes. Canonical authored edges follow assertion ownership: a Work Item depends_on prerequisite Work Items, belongs_to its planning/governance parent when declared, implements the PRD/ADR/requirement/decision it realizes, a Claim locks a Scope, and a Record records its subject. Add a read-only Work graph explorer that can inspect live repository projection output as JSON or Graphviz DOT so UAC review can validate graph facts directly. Implement JSON and DOT formatting as context-graph-compatible output extensions behind the local projection port, with the CLI selecting formats rather than owning formatter logic. Rename the family-wide command surface to dv work, provide dv wi as the terse shorthand, keep dv work-item only as an explicit compatibility/discovery alias if needed, and deprecate dv task as a legacy alias. Use a context-graph-aligned projection port that can adopt context-graph directly when the dependency path is low-friction, mirror Semantify's adapter/profile/projection shape for the first slice, and define explicit pivot signals before adopting Semantify directly.

## Coverage Model

### Actors

- repository maintainer

- implementation agent

- human contributor

- runtime command author

- governance policy author

- future package author

### Journey Stages

- projection

- claim creation

- scope acquisition

- scope renewal

- command mutation

- post-mutation verification

- audit and recovery

### Concerns

- canonical identity

- storage independence

- URI identity

- scope availability

- mutex safety

- least privilege

- deterministic projection

- command ergonomics

- command naming migration

- auditability

- graph contract

- migration path to Semantify

### Coverage Notes

- The MVP covers only the vertical behavior needed to execute Work through Claims with scope-governed mutation.

- Package registry, general GraphQL facade, code symbol traceability, hosted authority, and line-level scope remain follow-on capabilities.

## User Stories

1. As an implementation agent, I want a Work Item claim to reserve explicit read, write, and execute scopes, so that I can execute without colliding with another contributor.
   Covers: implementation agent / claim creation / mutex safety

2. As a repository maintainer, I want scope targets to use canonical ScopeRef identifiers instead of storage locations, so that scope policy survives file moves, storage changes, and future hosted adapters.
   Covers: repository maintainer / projection / storage independence

3. As a runtime command author, I want ScopeRefs to use URI formatting with registered short-form entity specifiers, so that command code can resolve stable targets without leaking file paths or storage adapters.
   Covers: runtime command author / projection / URI identity

4. As a governance policy author, I want scope availability checks to interpret read, write, and execute modes consistently, so that least-privilege policy is enforced before mutation.
   Covers: governance policy author / scope acquisition / least privilege

5. As a runtime command author, I want claim renewal to revalidate all associated scopes atomically, so that an expired or conflicting scope cannot be hidden by a timestamp update.
   Covers: runtime command author / scope renewal / scope availability

6. As a human contributor, I want command output to explain which canonical scope prevents my claim or mutation, so that I can resolve conflicts without learning runtime table details.
   Covers: human contributor / command mutation / command ergonomics

7. As a CLI user, I want family-wide operations under dv work with dv wi as a shorthand, so that I do not have to treat Task as the name for every Work Item subtype.
   Covers: human contributor / command mutation / command naming migration

8. As an implementation agent, I want commands to reproject and verify graph state after mutation, so that recorded state, projected scope, and authoritative storage cannot silently diverge.
   Covers: implementation agent / post-mutation verification / deterministic projection

9. As a future package author, I want the MVP graph to expose WorkItem, Claim, Record, and Scope nodes with locks and records edges, so that new entity types can participate as scope targets without changing the command lifecycle.
   Covers: future package author / projection / graph contract

10. As a repository maintainer, I want audit reports to show claim, scope, mutation, and record lineage, so that Work Item execution remains inspectable after cleanup or recovery.
   Covers: repository maintainer / audit and recovery / auditability

11. As a future package author, I want the Work Item + Claim MVP to define only the shared projection and scope contracts needed for this slice, so that later extension work can build on proven seams instead of speculative abstractions.
   Covers: future package author / projection / migration path to Semantify

12. As a repository maintainer, I want a read-only graph explorer with JSON and DOT output, so that I can validate Work graph UAC without inferring from command side effects or editing source files.
   Covers: repository maintainer / projection / graph contract

13. As a CLI user, I want graph projection over the live repository to skip or classify non-projectable documents deterministically, so that helper files such as backlog/AGENTS.md do not make graph inspection fail.
   Covers: human contributor / projection / deterministic projection

14. As a repository maintainer, I want non-mutating Work commands to migrate toward graph-backed reads in small slices, so that existing output contracts remain stable while graph facts become reviewable.
   Covers: repository maintainer / projection / command ergonomics

## Coverage Review

Status: `complete`

The stories cover projection, URI identity, graph inspection, claim creation, scope acquisition, renewal, mutation, verification, command naming, graph contract, and recovery across the Work + Claim vertical. Broader package and query facade concerns are explicitly deferred.

## Quality Review

- grounding: 5/5
  Rationale: Grounded in the current ADR set, runtime implementation, completed claim lifecycle Work Item, and the architecture review conversation.

- coverage: 5/5
  Rationale: Coverage is intentionally narrow and spans the full Work + Claim + Scope lifecycle.

- decision-rationale: 5/5
  Rationale: Major decisions preserve the agreed projection/command split, immutable claim identity, canonical ScopeRef identity, and dependency posture for context-graph and Semantify.

- testability: 4/5
  Rationale: Runtime and legacy Task command projection integration tests provide strong prior art; the new projection catalog and Work command seams will need focused contract fixtures.

- automation-readiness: 5/5
  Rationale: The PRD defines machine-readable scope, projection, gate, and verification behavior rather than relying on human convention.

This PRD is ready to decompose into implementation Work Items. The prior AFK blockers are resolved by the URI ScopeRef grammar, short-form entity type specifier rule, lock compatibility matrix, flat scope model, graph contract, command compatibility policy, refactor boundary, and dependency posture.

## Implementation Decisions

- Keep the current Work projection substrate behind a thin internal, context-graph-aligned port until a published package dependency is lower friction than the local seam.
  Rationale: The current MVP only needs deterministic node and edge projection plus simple in-process queries. Keeping that behind lib/work/** preserves package neutrality while avoiding sibling-workspace coupling.

  Category: `architecture`

- Mirror Semantify's adapter output, profile, projection rule, and projection result shape for the first Work Item + Claim slice before adding Semantify as a direct dependency.
  Rationale: Work Item normalization is the likely Semantify pivot point, but Doc-Vader needs one concrete slice to confirm that governance-specific scope and lifecycle semantics stay outside projection.

  Category: `architecture`

- Adopt canonical ScopeRef identity for claim scopes and keep storage adapter details out of scope targets.
  Rationale: Scopes must survive storage relocation or storage type changes; storage adapters resolve canonical identity to current backing storage.

  Category: `api-contract`

- Represent ScopeRefs as URI-formatted strings using the registered short-form entity type specifier as the URI scheme, for example wi:<stable-id>; if an entity has no registered short form, its long-form entity type is the canonical specifier.
  Rationale: URI formatting is widely understood, keeps the target adapter out of the stable identifier, and lets package-defined entities register concise command-facing specifiers without changing long-form module names.

  Category: `api-contract`

- For existing Work Item identifiers, canonical ScopeRefs use the entity-local ID body without duplicating the entity prefix, so persisted Work Item id wi-60343 normalizes to wi:60343.
  Rationale: The entity type already lives in the URI scheme. Duplicating it in the stable-id portion would make ScopeRefs noisier and harder to compare.

  Category: `api-contract`

- Keep short-form entity type specifiers canonical for identifiers and command-facing ScopeRefs, but keep long-form names for modules, package boundaries, and implementation directories.
  Rationale: This preserves CLI and graph ergonomics without forcing terse names into source layout or public package naming.

  Category: `technical-clarification`

- Use Work as the short family/domain term, keep Work Item as the schema-backed member artifact, and reserve Task for the Task subtype and legacy projection language.
  Rationale: Work Item is precise but cumbersome for CLI and family-level prose; Task is concise but incorrect because the command surface operates across the whole Work family.

  Category: `technical-clarification`

- Rename the family-wide dv task command surface to dv work, provide dv wi as the terse shorthand, keep dv work-item only as an explicit compatibility/discovery alias if needed, and retain dv task as a deprecated compatibility alias during migration.
  Rationale: The command operates on all Work Item subtypes, so the primary command name should reflect the Work family while preserving existing automation long enough to migrate safely.

  Category: `interface`

- Represent claim scopes as read, write, and execute privileges over one or more canonical ScopeRefs.
  Rationale: Work Item execution needs execute mutex on the Work Item target and write mutex on mutable artifacts while allowing policy-controlled read scopes for context.

  Category: `schema`

- Implement read, write, and execute compatibility as independent ReadLockPolicy, WriteLockPolicy, and ExecuteLockPolicy rules; in the MVP, reads coexist with reads, execute coexists with reads, and every other combination is mutually exclusive.
  Rationale: Atomic policies make later iteration cheap while preserving the initial safety rule that a read-locked target can be executed but not written.

  Category: `interaction`

- Add a first-class flat claim scope persistence model keyed by claim identity, ScopeRef, and lock mode; keep existing file locks as storage-adapter/resource locks behind that scope model.
  Rationale: ScopeRef abstracts beyond path locks while preserving the current local runtime safety behavior. Deferring nested scopes and umbrella claims is acceptable if the storage shape can later add parent or belongs_to relationships without rewriting flat scope rows.

  Category: `schema`

- Defer nested scopes and umbrella claims for the MVP.
  Rationale: The first slice only needs exact ScopeRef targets. A flat scope table plus graph edges leaves room to add hierarchy later without baking hierarchy into claim identity.

  Category: `technical-clarification`

- Treat claim identity as immutable and model renewal as lease extension gated by current scope availability.
  Rationale: A claim should not change its identity or target; renewal must fail if associated scopes are no longer available.

  Category: `interaction`

- Keep commands graph-informed but not graph-authoritative.
  Rationale: Commands should project, resolve, gate, mutate authoritative storage, reproject, verify, and record; direct graph mutation would create a second authority.

  Category: `architecture`

- Create lib/work/** as the new long-form implementation seam and leave lib/task/** as compatibility wrappers until callers and tests migrate.
  Rationale: The command surface is family-wide Work behavior, but a wrapper phase avoids breaking existing automation while moving implementation ownership away from the Task subtype.

  Category: `module-boundary`

- For command compatibility, dv work and dv wi are primary, dv work-item is optional discovery compatibility, and dv task remains a deprecated compatibility alias that preserves legacy JSON schema versions for one migration window.
  Rationale: New callers should see Work terminology, while existing AFK automation that expects task-list/task-status shaped output should not break during the refactor.

  Category: `interface`

- Model the MVP graph with WorkItem, Claim, Record, and Scope nodes; Code is a reserved future scope target, and Scope is a target abstraction rather than a superclass that replaces concrete entity nodes.
  Rationale: Treating Scope as a role avoids collapsing entity identity into authorization identity. WorkItem, Claim, and Record remain concrete nodes; Scope nodes carry ScopeRef identity and target-kind metadata so any concrete entity can be locked later.

  Category: `architecture`

- Canonical authored edge direction follows assertion ownership: the entity making the assertion points to the target it depends on, belongs to, implements, locks, or records.
  Rationale: One authored direction prevents dual sources of truth. Reverse traversal can be derived for queries and reports without making inverse edges separately persisted or user-authored facts.

  Category: `architecture`

- Include WorkItem --depends_on--> WorkItem, WorkItem --belongs_to--> WorkItem|Milestone|Project, WorkItem --implements--> PRD|ADR|Requirement|Decision, Claim --locks--> Scope, and Record --records--> WorkItem|Claim|Scope in the MVP graph contract.
  Rationale: These are the governing relationship edges needed for selection, grouping, traceability, authority, and audit lineage. Transient blocker state remains a derived operational finding, not a canonical relationship edge.

  Category: `architecture`

- Use Claim --locks--> Scope edges with mode and policy attributes, and Record --records--> WorkItem|Claim|Scope edges with record-kind attributes.
  Rationale: Lock mode and record purpose are relationship facts. Keeping them on edges prevents node-type explosion and makes audit lineage queryable without encoding workflow state into node kinds.

  Category: `architecture`

- Keep GraphQL optional and read-oriented for this MVP.
  Rationale: GraphQL may be useful for scope and graph inspection, but the first slice only requires deterministic in-process projection queries and CLI output.

  Category: `interface`

- Define a pivot gate for Semantify adoption after at least two Doc-Vader adapters or profiles duplicate Semantify runtime behavior.
  Rationale: This prevents long-term parallel implementations while avoiding premature coupling before Doc-Vader's governance-specific projection needs are concrete.

  Category: `technical-clarification`

- Use a thin internal projection port for context-graph integration: prefer a normal published/package-manager dependency when available, otherwise implement the minimal local port needed for the MVP and keep it contract-compatible with context-graph for later package extraction.
  Rationale: This minimizes development friction without committing Doc-Vader to a sibling repository path or a vendored fork, while preserving a clean route to separately published packages.

  Category: `architecture`

- Production code must not import a sibling workspace source path for context-graph, Semantify, or any other future package candidate; package adoption must happen through a normal package-manager dependency or stay behind the local seam.
  Rationale: Relative cross-workspace imports create hidden coupling to local checkout layout and make package extraction harder than maintaining the current minimal port.

  Category: `module-boundary`

- Expose graph projection through a read-only dv work graph / dv wi graph explorer before migrating existing Work commands to the graph as their backing read model.
  Rationale: The graph must be inspectable directly for UAC review. A dedicated read-only explorer gives maintainers a stable inspection surface without forcing all legacy Work command contracts to move at once.

  Category: `interface`

- Support JSON and Graphviz DOT output for the graph explorer; do not add a separate digraph output alias.
  Rationale: JSON is the automation and inspection format. DOT is the standard streamable graph visualization format and already describes directed graphs, so an additional digraph alias would add vocabulary without capability.

  Category: `interface`

- Implement graph explorer output formats as context-graph-compatible output extensions behind the local projection port rather than CLI-local formatters.
  Rationale: The CLI should choose an output extension and stream its result, not own graph serialization semantics. Keeping JSON and DOT behind an extension contract makes a future native context-graph migration a provider swap instead of a command rewrite.

  Category: `module-boundary`

- Make live repository graph projection robust to non-projectable documents by skipping, warning, or classifying them deterministically instead of throwing during graph inspection.
  Rationale: The current repository contains helper and policy documents such as backlog/AGENTS.md whose identifiers are valid documents but not graph ScopeRefs. Graph inspection must handle those documents without treating them as graph projection failures.

  Category: `architecture`

- Migrate non-mutating Work commands toward graph-backed reads in this order: dv wi list, relationship sections in dv wi show, derived readiness findings, then dv wi ready.
  Rationale: This sequence exercises graph-backed reads from lowest-risk to highest-governance impact while preserving existing body rendering, runtime diagnostics, and readiness output contracts during migration.

  Category: `interface`

- Keep dv wi status, dv wi prompt, dv wi claim, dv wi recover, and dv wi record out of the graph-backed command migration for this PRD slice.
  Rationale: These commands depend on runtime state, git worktree state, prompt/body rendering, or mutation-adjacent behavior. Moving them before graph-backed list/show/ready stabilizes would conflate inspection, selection, and mutation concerns.

  Category: `technical-clarification`

- Represent dependency, resource, policy, and evidence blockers as derived readiness findings rather than canonical relationship edges.
  Rationale: A blocker is a transient operational state, while relationship edges are durable authored facts. Keeping findings separate prevents resource conflicts or missing evidence from being misrepresented as Work Item dependencies.

  Category: `architecture`

- Pivot from the local projection port to a direct context-graph dependency when a published package is available and lower friction, or when Doc-Vader would otherwise reimplement provider-scoped graph writes, deterministic snapshot/provenance contracts, or compatibility fixtures beyond the current node and edge assembly.
  Rationale: The local port is acceptable MVP glue only while it stays thinner than the dependency it is standing in for.

  Category: `architecture`

- Keep ScopeRef canonicalization, claim-lock verification, and record-lineage projection local until a second slice needs the same normalization/runtime shape; pivot to Semantify when two or more Doc-Vader adapters or profiles would duplicate reusable normalization or data-catalog behavior.
  Rationale: The current projection slices are governance-specific glue, but repeated normalization/profile runtime work is the signal that Semantify should own that concern.

  Category: `technical-clarification`

## Testing Decisions

A Work Item can be claimed, scoped, renewed, mutated, and released only when projected graph state, runtime authority state, and authoritative artifact storage agree on canonical identity, scope availability, and post-mutation verification.

### Modules Under Test

- Artifact Graph Projection

- Work Item projection adapter

- Claim projection adapter

- Scope policy

- ScopeRef parser and normalizer

- Lock policy matrix

- Runtime Authority

- Work command adapter

- Legacy Task command compatibility alias

- Work Item Governance Kernel

- context-graph-aligned projection port

- Work graph explorer CLI

- context-graph-compatible output extensions

- DOT graph formatter

- Derived readiness findings

### Test Seams

- Projection contract (`integration`): Work Item, Claim, Claim lease, Claim scope, Record, and changed artifact facts must project into deterministic nodes and edges with provenance.

  Prior art:

  - context-graph deterministic snapshot and provenance tests

  - semantify projection runtime tests

- Scope availability gate (`integration`): URI ScopeRefs must normalize to canonical target identities, and read, write, and execute scope compatibility must be enforced before claim creation, lazy scope acquisition, renewal, and mutation.

  Prior art:

  - runtime SQLite claim and lock conflict tests

  - legacy Task command projection claim conflict tests

- Graph contract (`integration`): WorkItem, Claim, Record, and Scope nodes plus depends_on, belongs_to, implements, locks, and records edges must project deterministically with ScopeRef and relationship attributes.

  Prior art:

  - context-graph deterministic snapshot and provenance tests

  - work-item governance kernel tests

- Graph explorer CLI (`end-to-end`): Maintainers must be able to inspect live repository graph nodes and edges directly as JSON or DOT without mutating repository files or runtime state, and those output formats must be exercised through the same extension seam intended for context-graph migration.

  Prior art:

  - tests/work-projection.test.ts

  - existing Work command JSON output tests

- Derived readiness findings (`integration`): Selection blockers must be represented as derived findings separate from durable relationship edges so resource conflicts and missing evidence do not become authored dependencies.

  Prior art:

  - work-item governance kernel tests

  - deterministic backlog review profile tests

  - task ready selection tests

- Command lifecycle (`end-to-end`): The user-visible contract is project, resolve, gate, mutate, reproject, verify, and record for a Work Item execution path.

  Prior art:

  - legacy Task command projection dogfood lifecycle tests

  - changed-file lock audit tests

- PRD schema and rendering (`schema-contract`): The PRD JSON payload must validate before Markdown rendering and remain the automation source of truth.

### Prior Art

- tests/runtime-sqlite-store.test.ts

- tests/task-command.test.ts

- tests/work-item-governance-kernel.test.ts

- tests/canonical-task-model.test.ts

- tests/work-projection.test.ts

- context-graph package tests

- semantify package tests

### Validation Gates

- pnpm exec tsx cli/doc-vader.ts prd validate --payload docs/how-to/implementation-plans/doc-vader-work-item-claim-scope-mvp-prd.json

- pnpm run docs:lint

- doc-vader backlog validate --dir backlog --fail-on error

- pnpm run backlog:validate:ci

### Seam Review

Status: `confirmed`

Existing runtime and legacy Task command projection tests prove claim and lock behavior at integration boundaries; new projection fixtures are needed for URI ScopeRef canonicalization, lock compatibility, graph contracts, context-graph-aligned port behavior, and the Work command alias migration.

## Success Criteria

- The MVP defines URI ScopeRef syntax and normalization independent of storage adapters.

- Registered short-form entity type specifiers are canonical for ScopeRefs, with long-form fallback when no short form exists.

- Read, write, and execute lock compatibility follows the MVP matrix: reads coexist, execute coexists with read, and all other combinations conflict.

- Runtime persistence records flat claim scopes by claim identity, ScopeRef, and lock mode while retaining file/resource locks behind storage adapters.

- Family-wide CLI behavior is exposed through dv work with dv wi shorthand while dv task remains only a deprecated compatibility alias.

- Work Item and Claim projection adapters emit deterministic nodes and authored relationship edges with provenance.

- The graph projection emits WorkItem, Claim, Record, and Scope nodes plus depends_on, belongs_to, implements, locks, and records edges with required attributes.

- Live repository graph projection handles non-projectable policy/helper documents deterministically without crashing graph inspection.

- dv work graph and dv wi graph expose read-only graph inspection with JSON and DOT output.

- Graph explorer JSON and DOT outputs are implemented through context-graph-compatible output extensions rather than CLI-local serializers.

- Graph explorer filtering can inspect nodes, edges, edge types, source nodes, target nodes, and one-node neighborhoods without mutating state.

- dv wi list is graph-backed while preserving its current user-facing output contract.

- dv wi show renders graph-backed relationship sections while preserving canonical Work Item body rendering.

- dv wi ready uses graph relationships plus derived readiness findings without emitting blocks or relates_to as canonical authored edges.

- Claim creation records read, write, and execute scopes and rejects unavailable mutex scopes.

- Claim renewal extends the lease only after all associated scopes are still available.

- Commands verify post-mutation graph projection before recording success.

- Audit output can explain claim, scope, mutation, and evidence lineage for one Work Item execution.

- Production source code does not import sibling workspace paths for projection or normalization behavior.

- Semantify pivot signals are documented before duplicating projection runtime behavior beyond the first slice.

## Out of Scope

- General Package registry implementation.

- General GraphQL facade or GraphQL mutations.

- Hosted runtime authority.

- Line-level or symbol-level code traceability.

- Section-level document scopes.

- Nested scopes and umbrella claims.

- Full data catalog product surface.

- Migrating dv wi status to graph-backed output is out of scope for this slice because status combines runtime state, git worktree diagnostics, halted/recoverable analysis, and dirty/unlocked path checks that should stay hybrid until graph-backed list/show/ready are stable.

- Migrating dv wi prompt to graph-backed output is out of scope for this slice because prompt rendering depends on the full canonical Work Item body model, checklist content, and execution instructions rather than relationship facts alone.

- Migrating dv wi claim, dv wi recover, and dv wi record to graph-backed backing models is out of scope for this slice because they are mutation or mutation-adjacent flows and must continue to use authoritative command/runtime paths.

- Adding GraphQL, a generic query language, or a graph mutation API for inspection is out of scope because JSON and DOT explorer output provide enough reviewability without creating a second command surface or authority model.

- Schema-wide rename of frontmatter type: work-item, existing WI identifiers, or persisted historical file names.

- Generic lifecycle support for ADRs, PRDs, READMEs, tutorials, or contributor docs beyond what is needed to support the Work Item + Claim MVP.

## Agent Handoff

Ready label: `ready-for-agent`

- Start with contract fixtures for ScopeRef normalization and Work Item + Claim graph projection.

- Use URI ScopeRefs with registered short-form entity specifiers; do not encode file paths or storage adapters in ScopeRefs.

- Implement the MVP lock compatibility matrix before adding command mutation behavior.

- Create lib/work/** as the new implementation seam and leave lib/task/** as wrappers during migration.

- Introduce dv work and dv wi as the primary command entry points before removing or warning on dv task.

- Use a context-graph-aligned projection port; add a normal context-graph package dependency only when it is lower friction than the minimal local port.

- Implement graph explorer JSON and DOT output as context-graph-compatible output extensions so native context-graph adoption can reuse or replace the extension provider.

- Keep Semantify adoption behind the documented pivot gate.

- Reject sibling-workspace source imports in production code so package adoption happens through published dependencies rather than checkout-relative paths.

- Add a read-only graph explorer before migrating existing non-mutating Work commands to graph-backed reads.

- Support graph explorer output as JSON and DOT only; do not add a digraph alias.

- Migrate graph-backed Work command behavior in order: list, show relationship sections, derived readiness findings, then ready.

- Keep status, prompt, claim, recover, and record hybrid or legacy-backed in this slice unless a later PRD explicitly expands their graph-backed contract.

- Do not make GraphQL part of the command mutation path in the MVP.

## Further Notes

- Reference context: ADR-005 defines the top-level entity governance model.

- Terminology: Work is the short family/domain term for the work-management entity family. Work Item is the schema-backed member artifact. Task is one Work Item subtype and legacy projection term; Task must not be used as a synonym for Work or Work Item.

- Reference context: ADR-006 keeps Work Item canonical and Task as a projection over Work Item; this PRD narrows the follow-up rename from Task projection to Work command surface.

- Reference context: ADR-007 defines the local Runtime Authority and defers immutable scope graphs.

- Reference context: ADR-009 keeps ScopeRef independent from storage adapter details.

- AFK execution decision: canonical ScopeRefs are URI-formatted as <entity-type-specifier>:<stable-id>, where the specifier is the registered short form if one exists and otherwise the long-form entity type.

- AFK execution decision: existing Work Item id wi-60343 canonicalizes to ScopeRef wi:60343; adapters may accept non-canonical aliases during migration, but persisted new scope rows should use canonical ScopeRefs.

- AFK execution decision: MVP lock compatibility is read/read allowed, read/execute allowed, execute/read allowed, and every other mode combination conflicts.

- AFK execution decision: Scope is a graph target abstraction with ScopeRef identity and target-kind metadata, not a replacement for concrete WorkItem, Claim, Record, or future Code nodes.

- AFK execution decision: use flat claim scopes now; nested scopes and umbrella claims are deferred.

- Reference context: backlog/60343 records existing claim lifecycle and renewal policy.

- Reference context: backlog/60364 records existing atomic claim and lock acquisition behavior.

- Existing capability: Work Item frontmatter schema and Markdown-backed artifact storage.

- Existing capability: legacy Task command projection over Work Item, to be migrated behind the Work command surface.

- Existing capability: Runtime claims, file locks, execution logs, TTL, last_seen_at, renewal on mutation, and changed-file lock audit.

- Existing capability: Work Item Governance Kernel and evaluation primitives for checks, findings, review profiles, reports, and gates.

- Adapt capability: context-graph can provide the projection graph substrate immediately.

- Adapt capability: Semantify's profile and projection runtime shape should guide the Work Item normalization layer, with direct dependency triggered by documented pivot signals.

- Build capability: canonical ScopeRef model, read/write/execute scope schema, scope availability policy, and graph projection for Claim scopes.

- Build capability: command lifecycle verification that reprojects graph state after mutation and prevents success when expected graph facts do not appear.

- Package boundary guardrail: lib/work/projection.ts, lib/work/claim-verification.ts, and lib/work/scope-ref.ts are the current MVP seam and may compose in-repo runtime/task modules, but production code must not import sibling workspace source paths.

- Duplication inventory: lib/work/projection.ts node/edge assembly is acceptable MVP glue; keep it contract-compatible with context-graph and pivot instead of growing local provider/scenario-specific graph infrastructure.

- Duplication inventory: ScopeRef canonicalization and record/claim lineage subject normalization are acceptable MVP glue; keep them local until another non-Work slice needs the same normalization/profile runtime, then adopt Semantify instead of cloning more adapters.

- Dependency pivot signal: any future local reimplementation of provider-scoped graph behavior, deterministic snapshot/provenance, or reusable normalization/profile execution should be replaced with the package dependency instead of extended locally.

- Explorer requirement: dv work graph and dv wi graph are read-only UAC surfaces and must not mutate repository files, runtime claims, locks, records, or audit artifacts.

- Explorer requirement: JSON and DOT output must be implemented as context-graph-compatible output extensions behind the local projection port, not as one-off CLI serializers.

- Explorer requirement: JSON output is the automation format and DOT output is the renderable graph visualization format suitable for piping to Graphviz.

- Migration requirement: graph-backed list should be the first migrated non-mutating Work command because it only needs WorkItem nodes and stable ordering.

- Migration requirement: graph-backed show should initially source relationship sections from projection while retaining canonical Work Item loading for body, tasks, acceptance criteria, and prompt-oriented context.

- Migration requirement: graph-backed ready should wait for derived readiness findings so transient blockers remain separate from canonical relationship edges.

- Defer capability: broad Package registry, full GraphQL facade, hosted authority, section-level scope, and code symbol traceability.
