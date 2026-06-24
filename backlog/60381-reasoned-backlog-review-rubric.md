---
id: wi-60381
title: Backlog Review Synthesis Rubric
summary: Define the HITL rubric for interpreting backlog review reports, including scope clarity, acceptance criteria quality, decomposition, stale blockers, and grilling triggers.
type: work-item
subtype: spike
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 3
actual: 3
completed_date: '2026-06-23'
links:
  reference:
    - '[[60379-reasoning-level-execution-policy-spike]]'
    - '[[../docs/architecture/decisions/adr-005-entity-governance-primitive-model.md]]'
    - '[[../docs/architecture/decisions/adr-010-composable-evaluation-primitives.md]]'
    - '[[../schemas/work-management/CONTEXT.md]]'
  evidence:
    - '[[record-20260623-backlog-review-synthesis-rubric]]'
tags:
  - hitl
  - backlog
  - review
  - synthesis
  - grill
---

## Goal

Define the approved reasoning rubric for interpreting backlog review reports so
future automation can distinguish deterministic findings from reasoned synthesis,
route unresolved questions into focused grilling sessions, and emit AFK-ready
follow-up proposal batches without expanding the active review scope.

## Background

Deterministic backlog review can aggregate facts and findings, but deciding what
those findings mean often requires judgment. Examples include whether scope is
clear enough, acceptance criteria are objective, a paused item can be promoted,
a HITL item can be decomposed into AFK slices, or several findings point to one
unresolved architecture decision.

This work remains HITL because the output is a Work Item review interpretation
rubric and policy decision, not mechanical implementation. It references the
global reasoning-level execution policy spike, but it does not replace or define
that global execution model.

Backlog review has a deterministic core and an optional reasoning-backed
synthesis layer. Deterministic review runs checks, emits findings, and produces
declared summaries. Synthesis interprets those findings and requires a reasoning
actor: an actor, model, workflow, or reviewer approved for the relevant
scope-authority pair under current policy. Formal rubric and output schemas must
use actor, capability, approval, and policy terms rather than personhood as the
capability boundary; `HITL` remains only the current operational tag until the
reasoning-level execution policy is accepted.

## Rubric

Reasoned synthesis may interpret deterministic backlog review reports using the
following criteria:

- Scope clarity: the work has a single bounded outcome, names its non-goals when
  ambiguity is likely, and does not require choosing between unresolved designs.
- Acceptance criteria quality: criteria are observable, independently
  verifiable, and tied to concrete validation commands or review evidence.
- Implementation independence: the item can be completed in one branch or PR
  without hidden sequencing, broad repository coordination, or policy approval.
- Decomposition opportunity: broad or mixed items should be split when they
  contain separable implementation, policy, approval, or investigation branches.
- Stale blockers: paused or blocked items should identify whether dependencies
  are still live, superseded, completed elsewhere, or require a new approval.
- Obsolete or superseded work: synthesis may recommend closure or successor work
  when current records show the original scope is no longer the right target.
- Unresolved architecture decisions: findings that point to architectural
  ambiguity should route to focused grilling or ADR work rather than AFK
  implementation.

Synthesis may recommend action, but it must not directly mutate lifecycle state,
checkboxes, tags, claims, locks, records, or files. Any action beyond report
interpretation is represented as a proposal, approval requirement, or grilling
prompt.

## Approval Model

Synthesis outputs use `requiredApprovals` when a proposal, conclusion, or
decision cannot safely proceed under current operational policy. Each approval
requirement has two axes:

- `scope`: `rubric`, `architecture`, `repository`, `execution-policy`,
  `backlog`, `implementation`, `release`, `external-integration`, or `security`.
- `authority`: `interpretation`, `governance`, `administration`, or `execution`.

Examples:

- Backlog decomposition ambiguity uses `scope: backlog` with
  `authority: interpretation`.
- ADR-level choices use `scope: architecture` with `authority: governance`.
- Branch protection, required checks, secrets, workflow triggers, permissions,
  hooks, or access controls use `scope: repository` with
  `authority: administration`.
- AFK/HITL, reasoning-level, or unattended execution rules use
  `scope: execution-policy` with `authority: governance`.

Actor, model, workflow, or reviewer eligibility for those pairs is deferred to
the reasoning-level execution policy tracked by `60379`.

## AFK Proposal Criteria

A follow-up proposal may include the `afk` tag only when all of these are true:

- The work implements an accepted decision, schema, rubric, or command contract.
- The scope is narrow enough for one branch or PR.
- Acceptance criteria are objective and testable.
- Required inputs, dependencies, and evidence references are linked and current.
- The proposal does not require changing protected constraints, including branch
  protection, secrets, workflow triggers, required checks, permissions, hooks, or
  access controls.
- The proposal does not require changing AFK/HITL policy or reasoning-level
  policy.
- Validation commands are known and local.
- Expected mutations are limited to owned code, documentation, schema, or test
  surfaces.
- `requiredApprovals` is empty.

Absence of `afk` means guarded handling under current operational policy. A
proposal with any `requiredApprovals` must not include `afk`.

## Synthesis Output Expectations

Synthesis items must include enough information for downstream rendering without
performing additional reasoning:

- `id`
- `subjectRefs`
- `sourceFindingRefs`
- `decisionTopic`
- `openQuestion`
- `recommendedAnswer`
- `rationale`
- `evidenceRefs`
- `blockingReason`
- `decisionBranches`
- `priority`
- `confidence`
- `requiredApprovals`

Grilling prompts are rendered from these fields. The renderer does not infer
open questions or decision branches from raw findings.

## Follow-Up Proposal Batch

When synthesis recommends follow-up work, it emits a single JSON document by
default:

```json
{
  "schemaVersion": "work-item-proposal-batch/v1",
  "kind": "work-item-proposal-batch",
  "source": {
    "reportId": "backlog-review:example",
    "synthesisId": "review-synthesis:example",
    "profileId": "backlog-review"
  },
  "proposals": []
}
```

The proposal-batch schema should live under
`schemas/work-management/support/`. Each proposal is creation-command-ready and
contains canonical work-item `frontmatter`, canonical work-item `content`, and
proposal `provenance`.

Proposal rules:

- `frontmatter` validates against
  `schemas/work-management/frontmatter/work-item.json`.
- `content` validates against `schemas/work-management/content/work-item.json`.
- `frontmatter.id` is a deterministic provisional canonical id derived from the
  normalized title, with a deterministic short hash suffix on collision.
- `dedupeKey` is required, has the form `sha256:<hex>`, and is distinct from
  `frontmatter.id`.
- Batch validation rejects duplicate `frontmatter.id` or duplicate `dedupeKey`.
- `materializationMode` is a constant `propose-only`.
- The batch may include `generatedAt` as ISO 8601 metadata, but timestamps do
  not participate in dedupe.

The `dedupeKey` hash preimage includes schema version, source report id, sorted
source finding ids, sorted synthesis item ids, sorted subject refs, proposal
subtype, normalized title, normalized goal, sorted acceptance-criteria text, and
sorted required-approval tuples. It excludes provisional id, priority, estimate,
rationale prose, evidence ordering, timestamps, tasks, and output formatting.

## Examples

- Hosted authority and GitHub App work: repository administration or security
  approval remains required for branch protection, secret, workflow-trigger,
  required-check, permission, or bypass changes. Mechanical command or adapter
  slices can be AFK only when those decisions are already accepted.
- Artifact graph work: ADR-level nested identity and claim-scope decisions route
  to `scope: architecture`, `authority: governance`; implementation slices after
  the ADR can be AFK when bounded and testable.
- Pruned index semantics: historical resolver and collision semantics require
  interpretation or architecture approval until the contract is accepted; schema
  and resolver wiring after acceptance can be AFK.
- Linkity integration: external-integration contract decisions require
  governance approval; adapter wiring against an accepted contract can be AFK.
- Prune audit boundary work: audit-scope decisions require backlog
  interpretation or security approval depending on the boundary; deterministic
  reporting or validation gates can be AFK after that boundary is accepted.

## Tasks

- [x] Define reasoned synthesis criteria for scope clarity, acceptance criteria
      quality, implementation independence, decomposition opportunity, stale
      blockers, obsolete or superseded work, and unresolved architecture
      decisions.
- [x] Define which reasoned checks may only produce synthesis versus findings
      that can drive future workflow action.
- [x] Define confidence, rationale, and evidence expectations for reasoned
      synthesis.
- [x] Define when a finding or synthesis should create a follow-up backlog item
      instead of expanding the current session scope.
- [x] Define grilling triggers and prompt inputs for unresolved decisions.
- [x] Define how backlog-review synthesis references the reasoning-level spike
      without replacing AFK/HITL tags prematurely.
- [x] Provide examples using current HITL candidates such as hosted authority,
      artifact graph, pruned index semantics, Linkity integration, and prune
      audit boundary work.

## Deliverables

- Backlog review synthesis rubric.
- Synthesis output expectations.
- Grilling trigger taxonomy.
- Examples mapped to current backlog items.
- Recommendation for follow-up AFK implementation slices.

## Acceptance Criteria

- [x] The rubric clearly separates deterministic summary from reasoned
      synthesis.
- [x] The rubric identifies which conclusions may mutate nothing, recommend
      action, or require explicit approval under a scope-authority model.
- [x] Grilling triggers are specific enough to generate focused session prompts.
- [x] Scope-creep handling requires creating a proposal instead of expanding
      the active session.
- [x] The rubric preserves AFK/HITL tags as authoritative until the
      reasoning-level spike is accepted.
- [x] The rubric is clearly scoped to backlog review interpretation and does not
      duplicate the global reasoning-level execution policy decision.

## Relationships

- `reference`: `[[60379-reasoning-level-execution-policy-spike]]`
