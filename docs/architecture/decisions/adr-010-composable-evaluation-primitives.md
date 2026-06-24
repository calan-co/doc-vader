---
$schema: /frontmatter/document
id: adrcomposable-9010
title: Adopt composable evaluation primitives for governed entities
type: document
subtype: generic
status: ready
lifecycle: active
tags:
  - adr
  - architecture
  - entity-governance
  - extensibility
links:
  reference:
    - '[[adr-005-entity-governance-primitive-model.md]]'
    - '[[adr-008-work-item-governance-kernel.md]]'
    - '[[adr-009-storage-and-format-seams.md]]'
    - '[[../../../CONTEXT.md]]'
---

## Context and Problem Statement

Doc-Vader needs one evaluation model that works for built-in document and
work-management behavior as well as package-authored entity families. The same
model must support humans and agents, deterministic policy checks, reasoned
review, state-transition gates, document structure validation, template
validation, runtime authority, persistence, observability, and future hosted
execution.

Without a composable model, each use case invents its own vocabulary: lint
diagnostics, task readiness, backlog review, policy gates, package manifests,
claim health, storage validation, and state-transition checks all become
separate surfaces. That makes package authoring harder and weakens consistency
for daily consumers.

## Decision

Doc-Vader adopts composable evaluation primitives:

- `Check`: reusable evaluation question over a governed subject.
- `Finding`: recorded outcome of a check.
- `Review Profile`: tailoring that selects checks, scope, subjects, output
  grouping, severity mapping, and audience expectations.
- `Review`: governed orchestration of checks through a profile.
- `Report`: structured output of a review, including findings and deterministic
  summaries.
- `Summary`: deterministic condensation of report data using declared rules.
- `Synthesis`: optional reasoned interpretation over findings, reports, or
  summaries.
- `Run`: reserved execution-state primitive for checks that need durable
  in-flight tracking, retry state, resumability, or independent audit.

The composition model is:

1. A subject is resolved through an entity, artifact, document, runtime, or
   package registry.
2. A check evaluates that subject against policy, schema, state, structure,
   template, command, storage, or transition criteria.
3. The check emits zero or more findings with stable reason codes and evidence.
4. A review profile selects and configures checks for a target use case.
5. A review executes the profile over a declared scope.
6. A report aggregates findings and deterministic summaries.
7. Synthesis may interpret reports, but synthesis is not required to produce a
   valid report.

Native Doc-Vader domains use the same model:

- Schema and document type registries provide subject resolution and applicable
  check discovery.
- Subcommand and script definitions expose checks and reviews through CLI or
  automation surfaces without owning domain policy.
- State management expresses state-transition validity as checks and gates over
  entity state.
- Structure validation and template validation are checks over parsed artifact
  structure and declared templates.
- Backlog review is a Work Item review profile, not a separate primitive.
- Storage and format adapters provide persistence and serialization seams while
  checks remain independent of SQLite, files, Markdown, or JSON.
- Packages extend the registry with new entity definitions, schemas, templates,
  commands, checks, review profiles, and severity mappings.

## Decision Drivers

- Consumers need consistent CLI/API language across linting, readiness, review,
  policy, and state-transition workflows.
- Package authors need stable extension points that compose with built-in
  behavior instead of copying Work Item internals.
- Deterministic validation must remain separate from reasoned synthesis.
- Storage and format choices must not leak into evaluation semantics.
- Work-management should demonstrate the model without becoming the model.

## Consequences

Positive:

- Backlog review, linting, state-transition validation, and package checks can
  share output contracts and evidence semantics.
- Package authors can add checks and review profiles without forking command
  behavior or native schemas.
- Reports can be consumed by agents and humans without requiring reasoning.
- Reasoned synthesis can be layered on top of reports with explicit policy.

Negative/Risks:

- Existing Work Item and backlog commands must be refactored toward shared
  evaluation contracts over time.
- Review profile configuration must avoid becoming a second ad hoc policy
  language.
- The reserved `Run` concept may remain implicit until runtime audit needs
  justify first-class implementation.

## Validation

- Global primitive definitions live in the repo-level `CONTEXT.md`.
- Work-management context describes only Work Item-specific applications.
- AFK implementation slices first build shared check/finding/report/profile
  infrastructure, then implement backlog review as the first profile.
- Reasoned review work produces rubric and synthesis policy before automation
  mutates work items or creates follow-up work automatically.
