---
# yaml-language-server: $schema=https://raw.githubusercontent.com/calan-co/doc-vader/main/schemas/work-management/frontmatter/prd.json
"$schema": https://raw.githubusercontent.com/calan-co/doc-vader/main/schemas/work-management/frontmatter/prd
"$content_schema": schemas/work-management/content/prd.json
"$template": templates/reference/work-management/prd.md.tpl
"type": plan
"subtype": x-prd
"id": "prd-doc-vader-context-coordination"
"title": "doc-vader Context Coordination PRD"
"lifecycle": active
"status": ready
"summary": "JSON-first, schema-backed work-management with collaborative human-AI context governance, AFK safety gating, and concurrency-safe coordination primitives."
---

## Artifact Strategy

- Source of truth: `json-payload`
- Rendered views: `markdown`
- Preservation: Store the PRD content JSON sidecar alongside the rendered Markdown and treat JSON as canonical for automation.

## Context Grounding

doc-vader already has schema-backed work-management entities, lifecycle tooling, and validation gates. This PRD extends that foundation with collaborative human-AI context governance, AFK safety gating, deterministic manifests, composed least-privilege policy evaluation, scope-aware execution controls, and multi-contributor readiness. It incorporates Beads comparison learnings (concurrency-safe identity, dependency-aware ready selection, formula/work-graph orchestration, multi-agent coordination) while keeping authoritative replay out of v1.

### Domain Vocabulary

- curated context
- composed least-privilege
- bounding scope
- execution scope privileges snapshot
- CCQ (context curation quality)
- gating decision
- advisory decision
- immutable manifest
- decision dependency graph
- concurrency-safe ids
- claim/lease
- formula templates
- work graph
- routing
- gates
- BYOR
- semantic projection
- lineage
- fail-closed
- transparent operations
- ready.auto
- ready.recoverable
- paused.blocked
- paused.policy
- paused.system
- paused.manual

### ADR Alignment

No authoritative ADR was found for this exact context-governance/AFK model; alignment is based on current repository schemas, templates, and work-management conventions.

### Source Context

- Conversation-derived requirements and locked decisions across status model, CCQ gating, policy composition, manifest identity, and replay scope limits.
- schemas/work-management/frontmatter/prd.json
- schemas/work-management/content/prd.json
- templates/reference/work-management/prd.md.tpl

## Problem Statement

Concurrent human and AI contributors need curated, collaborative, trustworthy context at decision time. Current workflows are ambiguous around readiness, policy boundaries, dependency closure, provenance, interruption handling, and cross-contributor coordination, creating AFK safety risk, conflicting work, and coordination overhead.

## Solution

Adopt a JSON-first, policy-composed context-governance model in doc-vader where readiness, execution privileges, CCQ, dependency closure, and interruption states are explicit and machine-verifiable. Add concurrency-safe coordination primitives (claim/lease semantics, dependency-aware ready selection, formula/work-graph contracts) to support parallel contributors without policy or integrity drift. In v1, support verifiable decisions and best-effort reproducibility from manifests; defer authoritative replay infrastructure.

## Coverage Model

### Actors

- repository maintainer
- human reviewer/approver
- AFK automation controller
- implementation agent
- policy/governance owner
- concurrent contributor
- cross-repo integrator

### Journey Stages

- drafting
- readiness evaluation
- concurrent claim and assignment
- execution
- interruption and recovery
- formula/work-graph instantiation
- policy composition
- evidence and audit
- migration and alias management

### Concerns

- safety and fail-closed behavior
- deterministic explainability
- scope-bounded permissions
- multi-contributor concurrency safety
- dependency-aware parallel execution
- template-driven workflow repeatability
- cross-repo/extensibility
- operational migration risk
- automation usability
- performance and practicality

### Coverage Notes

- Coverage prioritizes execution-critical semantics and defers authoritative replay guarantees.
- Policy and schema decisions enforce monotonic safety (no child-scope relaxation).

## User Stories

1. As a repository maintainer, I want status and readiness semantics to be explicit and unambiguous, so that workers can reliably determine what can run now versus what is blocked or interrupted.
   Covers: repository maintainer / readiness evaluation / deterministic explainability
2. As an AFK automation controller, I want gating decisions to fail closed when required evidence is missing, so that unsafe execution never proceeds on stale or non-canonical context.
   Covers: AFK automation controller / execution / safety and fail-closed behavior
3. As a policy owner, I want composed least-privilege policy chaining with no scope-level relaxation, so that embedded scopes cannot weaken parent governance constraints.
   Covers: policy/governance owner / policy composition / scope-bounded permissions
4. As a human reviewer, I want deterministic triage packets with actionable remediation steps and blocked-scope bounds, so that I can resolve pauses quickly and confidently.
   Covers: human reviewer/approver / interruption and recovery / automation usability
5. As an implementation agent, I want execution scope privileges and CCQ assessments referenced as immutable artifacts, so that my run authorization is explicit and auditable.
   Covers: implementation agent / readiness evaluation / deterministic explainability
6. As a maintainer, I want external artifact aliases to be hash-verified with append-only migration events, so that relocation of referenced artifacts does not silently break integrity assumptions.
   Covers: repository maintainer / migration and alias management / operational migration risk
7. As a policy owner, I want advisory decisions to continue with explicit non-authoritative marking when aliases are unresolved, so that non-blocking workflows remain useful without overstating confidence.
   Covers: policy/governance owner / evidence and audit / automation usability
8. As a reviewer, I want inferential edges persisted with confidence, decay, and provenance metadata, so that dependency reasoning remains inspectable without pretending deterministic certainty.
   Covers: human reviewer/approver / evidence and audit / deterministic explainability
9. As an AFK controller, I want immediate safe-pause on integrity-breaking events and clear resume rules, so that runtime interruptions are predictable and policy-conformant.
   Covers: AFK automation controller / interruption and recovery / safety and fail-closed behavior
10. As a concurrent contributor, I want claim and scope boundaries that prevent accidental overlap, so that multiple human and AI implementers can work in parallel without conflicting mutations.
    Covers: concurrent contributor / concurrent claim and assignment / multi-contributor concurrency safety
11. As an implementation agent, I want ready selection to surface only unblocked, dependency-satisfied work, so that execution can proceed in parallel without violating dependency order.
    Covers: implementation agent / execution / dependency-aware parallel execution
12. As a maintainer, I want reusable formula templates that instantiate predictable work graphs, so that recurring workflows can be executed consistently by both humans and agents.
    Covers: repository maintainer / formula/work-graph instantiation / template-driven workflow repeatability

## Coverage Review

Status: `complete`

Stories cover all actors, stages, and concerns in the v1 coverage model.

## Quality Review

- grounding: 5/5
  Rationale: Grounded in locked conversation decisions and current repo PRD schema/template contracts.
- coverage: 5/5
  Rationale: Stories were generated from the explicit coverage model and reviewed for complete matrix coverage.
- decision-rationale: 5/5
  Rationale: Major design choices include explicit rationale and safety/operational tradeoff handling.
- testability: 4/5
  Rationale: State transitions, policy composition, and artifact integrity rules are testable through schema and CLI seams; some integration seams still need confirmation in implementation.
- automation-readiness: 5/5
  Rationale: JSON payload is canonical, with deterministic fields intended for validation/rendering and downstream automation.

Quality is implementation-ready; integration seam confirmation remains an explicit follow-up.

## Implementation Decisions

- Use decision classes advisory and gating in v1; defer authoritative replay to a future capability lane.
  Rationale: Keeps v1 practical while preserving fail-closed gating safety.
- Use composed least-privilege policy chaining with intersection of allows and union of denies/constraints.
  Rationale: Prevents inner scopes from relaxing parent controls and enforces monotonic governance.
- Make status required with no default and keep top-level states explicit: draft, ready, running, paused, completed, aborted.
  Rationale: Eliminates lifecycle ambiguity and enables deterministic state transitions.
- Define ready substatus as auto or recoverable only; approval is a pre-ready gate and not embedded in ready state.
  Rationale: Preserves ready as executable-now.
- Use paused substatuses blocked, policy, system, and manual; policy and system are mutually exclusive.
  Rationale: Keeps interruption causes explicit without state explosion.
- Require immutable execution scope privileges snapshots and immutable CCQ assessments referenced by id at ready.
  Rationale: Makes run authorization and quality gates durable and auditable.
- Model input-local fields as type and role, and source discriminator as source.kind to avoid type-name collisions.
  Rationale: Maintains schema clarity and deterministic extension validation.
- Split input semantics into type (artifact/projection/lineage/etc.) and role (gating/advisory).
  Rationale: Separates input identity from runtime use.
- Rename gating_inputs_resolved to gating_inputs_verified and require content_hash for gating/lineage/projection-relevant inputs.
  Rationale: Makes verification explicit and avoids weak readiness assertions.
- Persist inferential calculations and confidence snapshots in append-only artifacts for v1 instead of requiring reproducible recomputation guarantees.
  Rationale: Balances practical scope with auditability and transparency.
- Use immutable content identity with mutable alias mapping, append-only alias migration events, and hash verification on alias resolution.
  Rationale: Supports artifact relocation without sacrificing integrity checks.
- Keep unresolved advisory alias behavior policy-tunable with default warn-and-continue and explicit non-authoritative marking.
  Rationale: Preserves utility while preventing confidence overstatement.
- For incompatible canonicalization versions, block cross-version authoritative comparison until bridge rules are validated and activated.
  Rationale: Prevents unsafe equivalence assumptions across incompatible canonical forms.
- Treat projection and lineage as doc-vader-native schema types and include extension IDs when type or source.kind is other.
  Rationale: Enforces deterministic interoperability across extension points.
- Adopt concurrency-safe identifiers and claim/lease-friendly execution boundaries so multiple contributors can operate without collision.
  Rationale: Makes multi-user, multi-agent collaboration first-class rather than post-hoc.
- Define dependency-aware ready semantics so only dependency-satisfied work enters executable queues.
  Rationale: Prevents invalid parallelization and reduces out-of-order rework.
- Introduce formula/work-graph contracts for repeatable orchestration while keeping policy and scope controls authoritative.
  Rationale: Provides reusable workflow orchestration without weakening governance and safety gates.
- Support BYOR and distributed inputs/outputs through typed source contracts and relational version/location tracking.
  Rationale: Preserves portability and integration flexibility across multi-repo and externally versioned ecosystems.
- Use semantic projection as additive drift/impact evidence, not a replacement for source versioning and policy-governed decision records.
  Rationale: Improves semantic accuracy where available while preserving source-anchored governance.
- Resolve archive roots from `.doc-vader/backlog-consumer.json` rather than assuming `backlog/archive`.
  Rationale: Keeps archival validation and pruning aligned with the repository's configured work-management roots.
- Validate archived files against their declared `$schema` when present, and use a configurable fallback schema for legacy archived files that do not declare one.
  Rationale: Preserves explicit schema pinning without forcing noisy edits across historical records.
- Do not add `validated_at` or `validated_by` frontmatter fields to archived work items.
  Rationale: Validation provenance belongs in reports, git history, and command output rather than cluttering every archived artifact.
- Record pruned archived work items in a single pruned index, not discrete tombstone files and not an archive index.
  Rationale: The index represents files removed from the archive, while the active archive remains rooted in configured paths.
- Use `last_seen_commit` to identify the commit where the full archived Markdown file was last present before pruning.
  Rationale: This keeps historical lookup tied to git-managed source of truth without retaining the full file in the archive directory forever.
- Keep successor and reference links owned by successor artifacts and discoverable through link indexing/backlinks rather than duplicating them in the pruned index.
  Rationale: Avoids stale relationship metadata in historical tombstone records.
- Put archive pruning on the task command surface, such as `dv tasks prune --archived`, rather than introducing a separate backlog entity command.
  Rationale: Work-management operations act on tasks/work items, not a standalone backlog domain object.
- Make archive pruning atomic per file: persist and re-read the pruned-index record before deleting that file, then continue to the next candidate.
  Rationale: A failed candidate must not block the whole run or delete source material before its historical record is durable.
- Treat live link-resolution checks as normal lint/resolver responsibility, with dedicated tests for pruned-index resolution rather than running a full link-resolution pass after every pruned file.
  Rationale: Keeps pruning practical while still protecting resolution behavior through validation gates.

## Testing Decisions

Validate deterministic readiness gating, policy composition, immutable snapshot references, and fail-closed transitions under missing evidence and alias failures.

### Modules Under Test

- PRD content/frontmatter schema pipeline
- status and substatus transition evaluator
- concurrency claim/lease guard evaluation
- dependency-aware ready selector
- formula/work-graph contract evaluator
- policy composition and satisfiability linting
- execution scope privileges snapshot generation
- CCQ assessment computation and linkage
- alias resolver and migration event handling
- decision dependency closure evaluator

### Test Seams

- Schema-contract seam (`schema-contract`): Most v1 guarantees are encoded as structured contracts and deterministic field semantics.
- CLI lifecycle seam (`cli`): Readiness transitions and artifact rendering/validation should be testable through repository CLI commands.
- Integration decision-flow seam (`integration`): Critical to verify pause, triage, remediation, and resume behavior across composed policies and evidence references.

### Prior Art

- Existing work-management schema validation and frontmatter linting
- Backlog validation/reporting and profile-based gating patterns
- Semantify projection/provenance concepts considered for semantic inputs

### Validation Gates

- doc-vader prd validate on payload
- doc-vader prd render to markdown and json sidecar
- pnpm run docs:lint

### Seam Review

Status: `needs-confirmation`

Schema and CLI seams are clear; integration seam boundaries should be confirmed during the first execution-path slice.

## Success Criteria

- Ready-state artifacts reference immutable execution scope privileges and CCQ artifacts.
- Concurrent contributors can execute in parallel with deterministic conflict-avoidance semantics under bounded scope and privileges.
- Dependency-aware ready selection only surfaces unblocked execution candidates for AFK and human paths.
- Formula/work-graph instantiation produces deterministic, policy-conformant execution structures.
- Gating decisions fail closed when required verification evidence is missing.
- Policy composition is monotonic and explainable with actionable block reasons.
- Paused-state triage emits deterministic, machine-usable remediation instructions.
- Alias relocation updates preserve hash-verified resolution and migration audit trail.
- PRD payload validates against schema and renders to markdown reproducibly.
- Archive validation honors configured archive roots and declared or fallback schemas.
- Archive pruning preserves historical discovery through a durable pruned index before each deleted file is removed.
- Active backlog/work-item lifecycle states use canonical statuses without compatibility bloat in current work items.

## Out of Scope

- Authoritative replay guarantees across mutable external systems in v1
- Building full immutable evidence storage infrastructure in v1
- Replacing all existing repository planning artifacts immediately
- Auto-promotion of non-authoritative advisory outputs into gating decisions
- Migrating every historical archived work item solely to add validation provenance fields
- Running full live link-resolution checks after every individual archive prune operation

## Open Questions

- What exact path, schema id, and JSON shape should define the pruned index? Current preference is `backlog/pruned-index.json`, but the schema marker and required record fields still need to be finalized.
- Should the pruned index be strictly append-only forever, or may it support an explicit future compaction command with conservative age and safety criteria?
- What exact `.doc-vader/backlog-consumer.json` shape should configure legacy archive fallback schema validation, including severity for missing `$schema` frontmatter?
- What mechanism should intentionally bypass archive immutability for sanctioned archive migrations and pruning while still preventing ordinary archive edits?
- What is the final task command name and flag set for archive pruning: `dv tasks prune --archived`, `doc-vader tasks prune --archived`, or another spelling?
- What default grace period should apply before completed archived Markdown files are eligible for pruning, and should that default live in config, CLI flags, or both?
- How should `last_seen_commit` be computed when the worktree is dirty or an archived file has uncommitted changes; should pruning refuse uncommitted archive candidates?
- How should the resolver classify pruned-index records: historical-only, non-active, hidden from ready selection, or another explicit lifecycle category?
- If a live file and pruned-index record share the same id or historical path, which record wins and what diagnostic should be emitted?
- Is temp-file plus rename sufficient for per-file pruned-index persistence, or does the implementation need stronger fsync semantics?
- What prune report format should capture skipped candidates, retries, validation failures, and successful per-file deletions?
- Should prune failures create audit records, or is structured command output plus the unchanged source file sufficient?
- Should pruning categorically refuse candidates outside `roots.archive`, even when referenced by legacy config or migration code?
- Do active non-archived work items need immediate `$schema` remediation, or is explicit schema validation only required for archive/prune lifecycle work?
- When pruned-index resolver support is complete, what remaining compatibility code for legacy `closed` status and archived schemas can be removed safely?
- Should this PRD eventually gain the JSON sidecar promised by the artifact strategy, and if so where should that sidecar live?
- Should claim/lease semantics remain policy-governed privileges only, or become first-class lifecycle records?
- What is the minimum formula/work-graph schema in v1 versus deferred orchestration capability?
- What is the default unresolved advisory-alias policy per environment profile?
- What deterministic tie-break strategy should apply when equally specific bounding scopes match across distributed repos?
- What is the minimal integration seam contract for concurrent execution conflict tests in CI?

## Agent Handoff

Ready label: `ready-for-agent`

- Treat this JSON payload as canonical; markdown is a rendered view.
- Implement status/state contracts before optimization or UX layers.
- Keep fail-closed semantics for gating decisions as a non-negotiable invariant.
- Implement policy linting and explainability early to de-risk strict composition rollout.

## Further Notes

- Keep migration playbook guidance separate from mandatory v1 design contracts.
- Advisory unresolved-alias behavior remains tunable by policy profile.
- Cross-version canonicalization blocking remains in effect until active bridge rules exist.
- Decision dependency closure confidence is deterministic-edge based; inferential edges remain supporting evidence.
