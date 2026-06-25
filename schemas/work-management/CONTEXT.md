# Work Item Lifecycle

This glossary defines the canonical language for backlog work-item states and
reasons. It exists to keep status semantics consistent across schema, docs, and
automation.

## Language

**Work**:
The product and CLI term for the work-management entity family. Work includes
epics, features, stories, tasks, bugs, spikes, and other planned engineering
units that share lifecycle, relationship, evidence, and governance semantics.
Use `Work` for family-wide command surfaces and aggregate behavior.
_Alias_: work-management family
_Avoid_: Task as the family term; "a work" as the singular artifact name

**Work Item**:
A schema-backed member of Work with lifecycle state, completion criteria, and
evidence links. Use Work Item when referring to the persisted artifact,
frontmatter `type: work-item`, ID resolution, or schema contract.
_Alias_: WI, item, issue
_Avoid_: Ticket, task card, or task when referring to the canonical artifact
family

**Task**:
A Work Item subtype for small, directly executable units of work.
_Avoid_: Using Task as shorthand for all Work Items

**Work Command Surface**:
The family-wide CLI surface for Work operations. `dv work` should be the primary
human-readable command, `dv wi` may exist as a terse shorthand, and legacy
`dv task` behavior should migrate behind compatibility aliases.
_Avoid_: Naming family-wide commands after the Task subtype

**Task Projection**:
The legacy `dv task` command and Sandcastle-facing view over canonical Work Item
data plus runtime execution state. This projection should not remain the primary
family-wide command name.
_Avoid_: Treating task as a separate canonical repository entity or as the Work
family term

**Entity Type Specifier**:
The URI scheme used in command-facing and graph-facing identifiers. If an entity
type has a registered short form, the short form is canonical for identifiers
and ScopeRefs; otherwise the long-form entity type is canonical. Module names,
directories, and package names should use long-form terminology.
_Example_: `wi` for Work Item ScopeRefs, while implementation modules use
`work-item` or `work`
_Avoid_: Encoding storage adapters such as `file` in the entity type specifier

**ScopeRef**:
A URI-formatted canonical reference to a lockable graph target. ScopeRefs use
`<entity-type-specifier>:<stable-id>` and must not include file paths, database
keys, storage adapters, or other location-specific details. Storage adapters map
ScopeRefs to current storage locations. For existing Work Item identifiers, the
entity-local stable id omits the duplicated entity prefix, so persisted Work Item
id `wi-60343` canonicalizes to `wi:60343`.
_Example_: `wi:60343`
_Avoid_: `file:backlog/60343-example.md` as a canonical scope target

**Scope**:
A graph target abstraction identified by a ScopeRef. Work Items, Claims, Records,
and future Code artifacts can participate as scope targets, but Scope is not a
replacement for those concrete entity nodes.
_Avoid_: Treating Scope as a superclass that erases concrete entity identity

**Lock Policy**:
An atomic compatibility rule for a lock mode. The MVP defines independent
ReadLockPolicy, WriteLockPolicy, and ExecuteLockPolicy behavior: read coexists
with read, execute coexists with read, and every other mode combination
conflicts.
_Avoid_: A monolithic lock policy that makes mode-specific evolution expensive

**Nested Scope**:
A hierarchical or umbrella scope relationship where one ScopeRef covers other
ScopeRefs. Nested scopes and umbrella claims are intentionally deferred for the
MVP; flat ScopeRef locks must leave room for a future parent/contains
relationship.
_Avoid_: Baking scope hierarchy into claim identity

**Work Item Governance Kernel**:
The deep module responsible for canonical Work Item interpretation, including
lifecycle validity, readiness, dependency state, AFK/HITL classification,
evidence readiness, archive eligibility, and machine-readable findings.
_Avoid_: Reimplementing Work Item rules independently in task, scan, lint, or
plugin adapters

**Backlog Review Profile**:
A Work Item review tailoring that applies global Doc-Vader checks to backlog
documents and records, producing findings, reports, summaries, and optional
synthesis without making backlog review a separate primitive.
_Avoid_: Hard-coded backlog review flows that cannot be reused by other document
stores or package-defined entity families

**Record**:
A separate work-management artifact used to capture evidence, approvals,
commentary, and other supporting observations linked to work items.
_Avoid_: Treating linked rationale as inline work-item body content

**Record Subtype**:
The classification of a record within the `record` artifact type.
_Avoid_: Calling this a separate record type when the schema model is actually
`type: record` plus `subtype`

**Justification Record**:
A `record` artifact subtype used to capture rationale for work-item lifecycle
decisions without mutating the work-item body.
_Avoid_: Overloading `comment` for authoritative lifecycle rationale

**Evidence Record**:
A `record` artifact subtype used to capture proof artifacts for implementation or
verification outcomes.
_Avoid_: Treating rationale records as equivalent to implementation evidence

**Comment Record**:
A `record` artifact subtype used for contributor discussion and back-and-forth
context about a work item.
_Avoid_: Treating comment records as closure-authority artifacts

**Architecture Decision Record (ADR)**:
A durable architecture-level decision artifact for hard-to-reverse choices with
meaningful trade-offs.
_Avoid_: Using ADRs for routine work-item state decisions

**Proposed**:
A pre-decision state for items not yet accepted into execution flow.
_Avoid_: Triage (as a status), queued

**Status Reason**:
A qualifier that explains why an item is in its current status.
_Avoid_: Treating reasons as separate lifecycle states

**Work Item Body**:
The primary markdown content of a work item, intended to remain largely immutable
after creation except for checklist progress and narrow clarification edits.
_Avoid_: Using the body as a mutable decision log

**Wontfix**:
A decision that a valid request will not be implemented.
_Avoid_: Rejected, cancelled

**Wontfix Closure**:
A closed work-item outcome that does not require implementation proof such as a
merged pull request and may leave actual effort absent, null, or set to 0.
_Avoid_: Treating it as equivalent to completed delivery closure

**Subtype-Specific Links**:
Discrete link properties under `links` aligned to record subtypes (for example
justification, evidence, comment, approval, audit*notes) to preserve
discoverability.
\_Avoid*: Collapsing distinct rationale and proof artifacts into a single generic
link bucket

**Schema-First Canonicality**:
Lifecycle transitions and status-reason contracts are canonical in schema
artifacts first, with documentation derived from and aligned to schema.
_Avoid_: Maintaining a doc-first transition specification that can drift from
enforcement

**Schema-Enforced Ruleset**:
Work-item lifecycle and closure invariants are strictly defined and enforced in
schema rather than optional consumer profile toggles.
_Avoid_: Making core lifecycle constraints configurable when they are intended as
canonical contract behavior

**Versioned Validation Contract**:
When lifecycle semantics require stricter schemas, mint a new schema version for
changed items while preserving archive validation on the configured historical
baseline version.
_Avoid_: Breaking archive validation by retrofitting new constraints into
historical baseline schemas

**Beta Minor Versioning Policy**:
During beta-stage schema evolution, lifecycle contract tightening is released as
a minor version bump while retaining baseline archive validation on the pinned
historical version.
_Avoid_: Treating beta schema updates as mandatory major bumps when the
repository policy favors iterative minor evolution

**Dual-Track Consistency Interim**:
Until consolidation is complete, both schema tracks must remain semantically
aligned for lifecycle behavior.
_Avoid_: Introducing rule drift between parallel schema paths during transition
planning

**Falsey Actual Guardrail**:
If status is closed and actual effort is falsey, at least one justification link
is required regardless of status reason.
_Avoid_: Allowing zero or absent effort values without explicit rationale

**Non-Completed Closure Guardrail**:
If status is closed and status reason is not completed, at least one
justification link is required regardless of actual value.
_Avoid_: Closing as a decision outcome without explicit rationale linkage

**Completed Closure Link Burden**:
For closed items with status reason completed, delivery-oriented links carry the
primary validation burden while justification links are optional unless another
guardrail requires them.
_Avoid_: Requiring justification by default for all completed closures when
delivery evidence already satisfies closure intent

**Canonical Consolidation Plan**:
A defined migration plan is required to converge from dual schema tracks to one
canonical ownership path.
_Avoid_: Keeping parallel tracks indefinitely without an explicit convergence
strategy

**Versioned Frontmatter Stack**:
The frontmatter schema tree is intentionally structured with
current/latest/versioned artifacts and support contracts to provide first-class
version management from inception.
_Avoid_: Treating the frontmatter tree as ad hoc duplication when it was designed
for managed schema evolution

**Schema Tooling Lineage**:
The frontmatter layout is derived from Wikimedia jsonschema-tools conventions and
was originally enforced through that ecosystem.
_Avoid_: Ignoring tooling lineage when choosing canonical schema ownership

**Hybrid Versioning Strategy**:
Schema governance combines immutable semver releases, explicit
compatibility-level gating, and migration-led evolution.
_Avoid_: Relying on a single mechanism when release safety, compatibility
discipline, and migration ergonomics all matter

**Standard Suite Publisher**:
Docvader publishes a standard schema suite on a stable cadence once contracts
mature.
_Avoid_: Treating project-local schema updates as immediate upstream
standard-suite releases

**BYOS (Bring Your Own Schema)**:
Consumers may supply process-specific schemas while preserving compatibility
expectations with the published standard suite.
_Avoid_: Forcing all adopters onto one lifecycle vocabulary when process
divergence is intentional

**Rejected**:
A decision that the request or framing is invalid.
_Avoid_: Wontfix

**Cancelled**:
A decision that work should stop due to changed constraints or superseding
priorities.
_Avoid_: Rejected

**Clarification Edit**:
A narrow correction or missing-information update allowed when a proposed item is
in a needs-info state.
_Avoid_: Rewriting scope or decision history in place

**Revisit Policy**:
Substantive follow-up on a closed work item is represented as a new work item
that links back to the closed source item.
_Avoid_: Reopening closed work items for new scope or renewed implementation
intent

**Backward Transition**:
A lifecycle move from a later active status to an earlier active status when
review or execution reveals incompleteness, insufficiency, or missing
prerequisites.
_Avoid_: Treating all backward moves as invalid when they represent legitimate
workflow correction

**Readiness Rollback Rule**:
When review determines a work item is not implementation-ready, it rolls back to
proposed with status reason needs-info.
_Avoid_: Rolling back non-ready items to ready when intake clarification is still
required

**Active-State Rollback Matrix**:
Allowed backward transitions are explicitly enumerated as:
ready-for-review -> in-progress, in-progress -> ready, in-progress -> proposed,
ready -> proposed, and ready-for-review -> proposed plus needs-info.
_Avoid_: Implicit or ad hoc rollback paths outside the approved matrix

**No Backward-Closure Jump**:
Backward transition policy never permits a direct rollback jump to closed.
_Avoid_: Using closed as a rollback target for active-state corrections

**Category-Only Transition Rules**:
Transition authoring may use reason classes and optional wildcard authoring
sugar, but released transition contracts are defined entirely through
category-based constraints without explicit pair-level override rules.
_Avoid_: Mixing category-driven transitions with ad hoc pair overrides that
fragment rule semantics

**Allow-Only Transition Model**:
Transition rules are allow-only; effective target states are computed as the
union of matched allow rules under deterministic precedence.
_Avoid_: Introducing deny semantics before concrete use cases justify the added
complexity

**Suspicious-But-Valid Diagnostics**:
Certain rule-shape smells are surfaced as warnings (not hard failures),
including contradictory duplicates, shadowed rules, dead rules, dominated rules,
always-empty sources, unreachable destinations, redundant wildcards, and
identity-churn patterns.
_Avoid_: Treating these diagnostics as blocking schema validity in the current
allow-only model

**Status Reason Connectivity Class**:
Declarative lifecycle participation classification for status reasons using
`start | intermediate | end`.
_Avoid_: Encoding connectivity intent only in imperative evaluator heuristics

**Implicit Intermediate Default**:
Any status reason omitted from explicit connectivity declarations is treated as
`intermediate`, and this default is declared in schema.
_Avoid_: Hidden evaluator-only fallback behavior (magic string defaults)

**Syntax vs Semantic Severity Split**:
Malformed rules and invalid domain values are hard errors, while resolved-graph
lifecycle intent issues are warnings.
_Avoid_: Blocking schema/load workflows on non-structural semantic smells

**Best-Effort Partial Fix Policy**:
Autofix and formatting may apply partial, valid changes in the presence of
semantic warnings, while syntax/domain errors still block mutation.
_Avoid_: All-or-nothing fix behavior when non-blocking semantic issues are
present

**Formatter Exit-Code Convention**:
Fix/format mode exits successfully when only warnings are present, while
check/lint mode is the CI gating surface for non-compliant content;
syntax/domain errors remain non-zero in all modes.
_Avoid_: Failing fix mode solely due to semantic warnings when best-effort
mutation succeeded

**Strict Severity Promotion Mode**:
An optional `--strict` CLI mode upgrades semantic warnings to errors for teams
that want hard enforcement in local workflows or CI.
_Avoid_: Baking one enforcement posture into the default command behavior for
all consumers

**Consumer Severity Authority**:
Repository consumer configuration such as `.doc-vader/backlog-consumer.json`
remains authoritative for baseline severity policy and must continue to be
honored by validation commands.
_Avoid_: Letting new CLI flags silently bypass configured repository severity
expectations

**Severity Composition Rule**:
CLI severity modifiers such as `--strict` compose with consumer configuration
rather than replacing it, so configured repository policy remains the default
source of truth.
_Avoid_: Treating runtime flags as unconditional overrides of persisted consumer
policy

**Strict Non-Override Rule**:
`--strict` must not override or reinterpret persisted consumer severity
settings; repository consumer configuration remains authoritative for severity
decisions.
_Avoid_: Surprising users by silently promoting configured warnings to errors
through a CLI flag

**Strict Selective Escalation Rule**:
Under `--strict`, diagnostics are escalated only when consumer configuration has
not explicitly set the message category to `warn` or lower.
_Avoid_: Ignoring explicit consumer downgrade intent in the name of strictness

**Strict Masking Notice**:
When `--strict` is active and consumer configuration suppresses a potential
escalation, the CLI should emit an explicit notice that strict escalation was
masked by consumer policy.
_Avoid_: Silent strict-mode behavior that appears inconsistent without policy
context

**Local Generic Graph Core**:
Transition analysis should use a local reusable graph resolution/query layer with
lifecycle-specific validation as a thin policy pass.
_Avoid_: Single-purpose lifecycle logic fused directly into one linter rule

**Context-Graph Promotion Threshold**:
Keep transition graph logic local until sustained multi-consumer demand justifies
extracting it into `@templjs/context-graph`.
_Avoid_: Premature dependency expansion for a single dominant validation surface

**Transition Event Boundary**:
Lifecycle transition logic and transition event emission occur only when status
or status reason changes; all other metadata-envelope updates are non-transition
updates.
_Avoid_: Logging transition events for non-lifecycle field changes

## Flagged Ambiguities

- Ambiguity: Proposed plus wontfix implies both pending and decided.
  Resolution: Wontfix is closed-only and is not valid for proposed.

- Ambiguity: Closure rationale could be recorded in the work-item body.
  Resolution: The work-item body is largely immutable, so closure rationale
  should live in structured metadata or linked evidence records instead.

- Ambiguity: "Record type" could mean either a top-level artifact kind or a
  record classification.
  Resolution: In this repository, rationale-specific variants such as comment or
  decision are record subtypes, not top-level types.

- Ambiguity: AFK/HITL could be treated as intrinsic work properties.
  Resolution: AFK/HITL are current operational classifications. A future
  reasoning-level model may separate work complexity from execution policy, but
  tags remain authoritative until that rubric and mapping are adopted.

- Ambiguity: A decision-like rationale artifact could overlap with ADRs.
  Resolution: Work-item lifecycle rationale uses justification records; ADRs are
  reserved for architecture decisions.

- Ambiguity: Justification and comment may appear interchangeable.
  Resolution: They are orthogonal subtypes: justification captures authoritative
  rationale, while comment captures discussion.

- Ambiguity: Justification records could be treated as evidence records.
  Resolution: Justification and evidence are distinct subtypes and remain
  non-interchangeable.

- Ambiguity: A single generic evidence link list could hide subtype intent.
  Resolution: Link properties should be discrete per subtype for discoverability.

- Ambiguity: Closed-state requirements may be treated uniformly for all status
  reasons.
  Resolution: Closed invariants are reason-specific: completed requires
  evidence-oriented delivery links; wontfix/rejected/cancelled require
  justification links and allow zero actual effort.

- Ambiguity: Revisiting closed work could be handled by reopening items.
  Resolution: Revisit uses a new linked work item; reopening is reserved for
  narrow metadata correction only.

- Ambiguity: Transition rules could be canonicalized in docs before schema.
  Resolution: Transition rules are schema-first; docs reflect schema as
  explanatory guidance.

- Ambiguity: Stricter lifecycle rules could be applied directly to existing
  baseline schemas.
  Resolution: Stricter rules require a new schema version when validation
  configuration pins archive to a prior baseline.

- Ambiguity: Tightened lifecycle semantics in beta might require a major schema
  bump.
  Resolution: In this repository's beta phase, these changes are published as a
  minor version.

- Ambiguity: Maintaining two schema paths could be treated as a permanent
  architecture.
  Resolution: Preserve consistency now, but explicitly plan and execute
  consolidation to a single canonical path.

- Ambiguity: Zero or missing actual effort could be interpreted as either valid
  low effort or missing data.
  Resolution: For closed items, falsey actual values require linked
  justification independent of status reason.

- Ambiguity: Non-completed closed outcomes might rely on actual effort values to
  determine rationale requirements.
  Resolution: Non-completed closed outcomes always require justification
  regardless of actual.

- Ambiguity: Completed closure could be forced to include justification even
  when delivery evidence is present.
  Resolution: Completed closure treats justification as optional by default and
  prioritizes delivery-evidence requirements.

- Ambiguity: Core lifecycle rules could be relaxed or hardened via profile
  configuration.
  Resolution: Core lifecycle rules are strict schema requirements for all
  consumers.

- Ambiguity: Lifecycle transitions might be modeled as strictly forward-only.
  Resolution: Backward transitions among active states are allowed for valid
  correction and readiness reassessment scenarios.

- Ambiguity: Review-stage rollback for non-ready work could target either ready
  or proposed.
  Resolution: Non-ready review rollback targets proposed plus needs-info.

- Ambiguity: Backward transitions may be interpreted as open-ended among all
  statuses.
  Resolution: Backward transitions must follow the explicit active-state
  rollback matrix only.

- Ambiguity: Rollback logic might allow direct closure from active-state
  correction flow.
  Resolution: Active-state rollback does not include direct backward moves to
  closed.

- Ambiguity: Category-based transition rules might still need pair-specific
  exception overrides.
  Resolution: Transition model removes pair override rules and relies on
  category-based constraints only.

- Ambiguity: Overlapping transition rules in an allow-only model may indicate
  author intent errors.
  Resolution: Keep schema validity strict for structural integrity, and surface
  intent-level overlap smells as warning diagnostics.

- Ambiguity: Connectivity expectations for reason nodes may be under-specified
  when declarations are sparse.
  Resolution: Use explicit `start | intermediate | end` classes, with undeclared
  reasons defaulting declaratively to `intermediate`.

- Ambiguity: Evaluator diagnostics could block authoring/fix workflows despite
  structurally valid configuration.
  Resolution: Syntax/domain violations are errors; semantic/connectivity
  findings are warnings and permit best-effort partial fixes.

- Ambiguity: Warning findings in fix mode could be treated as hard failures via
  exit code policy.
  Resolution: Fix/format mode returns success with warnings; check/lint mode
  remains the non-zero enforcement path, and syntax/domain errors still fail.

- Ambiguity: Teams with stricter lifecycle governance may need warnings to block
  in automation.
  Resolution: Provide an optional `--strict` mode that promotes semantic
  warnings to errors without changing the default severity policy.

- Ambiguity: Introducing `--strict` could conflict with persisted severity
  configuration in `.doc-vader/backlog-consumer.json`.
  Resolution: Consumer configuration remains authoritative by default, and CLI
  strictness composes with rather than replaces configured severity behavior.

- Ambiguity: `--strict` might globally reinterpret consumer-configured warning
  severities as errors for a single invocation.
  Resolution: `--strict` does not override consumer-configured severity;
  persisted consumer policy remains authoritative.

- Ambiguity: Strict mode may appear ineffective when consumer policy explicitly
  downgrades specific diagnostics.
  Resolution: Strict mode escalates only non-explicit categories and emits a
  masking notice when consumer policy blocks escalation.

- Ambiguity: Shared graph analysis for lint/fix/authoring might require
  immediate centralization in `@templjs/context-graph`.
  Resolution: Implement a local generic graph core first and promote only when
  reuse pressure is proven.

- Ambiguity: Re-submitting unchanged lifecycle state with other metadata edits
  could trigger transition events.
  Resolution: No-op lifecycle tuples are treated as non-events and do not invoke
  transition logic or transition logging.

- Ambiguity: Canonical ownership could be chosen without considering
  version-management architecture.
  Resolution: Canonical ownership must account for the intentional versioned
  frontmatter structure and its jsonschema-tools lineage.

- Ambiguity: Version governance could optimize for cadence or compatibility, but
  not both.
  Resolution: The model intentionally combines semver releases, compatibility
  gates, and migration workflows.

- Ambiguity: Publishing a standard suite could conflict with consumer-specific
  process needs.
  Resolution: Docvader publishes a stable baseline suite while supporting BYOS
  for local process fit.

- Ambiguity: Should closed items always require implementation evidence.
  Resolution: Closed plus wontfix bypasses pull-request evidence requirements
  and allows zero actual effort while remaining explicitly closed.

## Example Dialogue

Developer: This item is proposed and marked wontfix.
Domain Expert: That is inconsistent. Proposed means undecided, but wontfix means
decided.
Developer: So where does a valid request we will not do go?
Domain Expert: Closed with status reason wontfix.
Developer: And when is rejected used?
Domain Expert: Only when the request itself is invalid.
Developer: Where should a wontfix rationale go if the body should not be
rewritten?
Domain Expert: In structured evidence linked from the work item, not as a
mutable body section.
Developer: Should that be a new record type?
Domain Expert: No, a new record subtype under the existing record type.
Developer: Won't a decision-like subtype conflict with ADR naming?
Domain Expert: Use a justification subtype for workflow rationale and reserve
ADR terminology for architecture decisions.
Developer: Is justification just a renamed comment?
Domain Expert: No. Comments are discussion threads; justifications are
authoritative rationale records.
Developer: Does closed plus wontfix still require merged PR evidence?
Domain Expert: No, it can bypass PR evidence and still remain validly closed.
Developer: What values are valid for actual effort on decision-only closure?
Domain Expert: It may be absent, null, or 0.
Developer: Is a justification link sufficient if it lives under generic evidence
links?
Domain Expert: No, justification and evidence should have separate link
properties for discoverability.
Developer: Does every closed reason require the same link contract?
Domain Expert: No, contracts vary by status reason, with delivery proof for
completed and rationale proof for wontfix/rejected/cancelled.
Developer: If a closed item needs fresh scope later, do we reopen it?
Domain Expert: No, create a new work item and link it back to the closed source
item.
Developer: Should the transition matrix live in docs first or schema first?
Domain Expert: Schema first, then align docs to the schema.
Developer: Can we tighten the current schema in place if archive still validates
on v1.0.0?
Domain Expert: No, mint a new schema version and keep archive validation pinned
to the configured baseline.
Developer: Should that new version be major because constraints get stricter?
Domain Expert: No, use a minor bump while the contract is still in beta.
Developer: Do we choose one canonical path now or keep both?
Domain Expert: Keep both consistent for now and produce a concrete consolidation
plan to converge to one canonical path.
Developer: How should we treat falsey actual effort values?
Domain Expert: For closed items, if actual is falsey, require justification
regardless of status reason.
Developer: What about closed outcomes that are not completed but have positive
actual effort?
Domain Expert: They still require justification; non-completed closure always
carries rationale.
Developer: For completed closure, is justification mandatory by default?
Domain Expert: No, completed closure makes justification optional unless another
closed guardrail requires it.
Developer: Should pull-request and closure invariants be configurable by
consumer profile?
Domain Expert: No, these are strict schema rules, as are all lifecycle rules
discussed here.
Developer: Can ready-for-review move back to in-progress after review feedback?
Domain Expert: Yes, backward transitions among active states are valid when work
is incomplete or insufficient.
Developer: If review finds the item is not implementation-ready at all, where
should it go?
Domain Expert: Move it to proposed with needs-info.
Developer: Which rollback transitions are valid between active states?
Domain Expert: ready-for-review -> in-progress, in-progress -> ready,
in-progress -> proposed, ready -> proposed, and ready-for-review -> proposed
plus needs-info.
Developer: Can rollback jump directly to closed?
Domain Expert: No, rollback flow never uses closed as a direct backward target.
Developer: Should category transitions still allow pair override exceptions?
Domain Expert: No, simplify by removing pair overrides and enforcing
category-based constraints only.
Developer: Should we keep deny rules to resolve overlap intent?
Domain Expert: No, keep allow-only for now and capture overlap smells as
warnings for future refinement.
Developer: If ownership changes but status+reason stays the same, is that a
transition?
Domain Expert: No, transition processing and logs are only for status or reason
deltas.
Developer: Does the frontmatter structure have any deliberate design intent for
versioning?
Domain Expert: Yes, it was intentionally designed for version management and
inherited patterns from jsonschema-tools.
Developer: Should we choose one versioning pattern or combine several?
Domain Expert: Combine immutable semver, compatibility checks, and
migration-led rollout.
Developer: If docvader publishes standards, can users still customize?
Domain Expert: Yes, BYOS is a first-class model for process-specific schemas.
