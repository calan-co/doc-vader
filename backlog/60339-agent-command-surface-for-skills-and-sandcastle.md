---
id: wi-60339
title: Agent Command Surface for Skills and Sandcastle
summary: Shape and then implement deterministic Doc-Vader CLI commands for configured template-aligned document creation, rendering, validation, state progression, issue selection, and closure so skills and Sandcastle use the same safe automation surface.
type: work-item
subtype: story
lifecycle: active
status: ready
priority: critical
estimated: 8
links:
  reference:
    - '[[60333-canonical-schema-profile-routing-and-fixtures]]'
    - '[[60338-hosted-saas-github-app-architecture-adr]]'
    - '[[60340-artifact-graph-and-nested-claim-architecture-adr]]'
    - '[[60341-task-ready-afk-eligibility-query]]'
    - '[[60342-task-scope-reservation-and-lookup]]'
    - '[[60343-task-claim-store-and-lifecycle]]'
    - '[[60344-claim-bound-artifact-reservations]]'
    - '[[60345-claim-aware-record-and-close-commands]]'
    - '[[60346-sandcastle-doc-vader-task-adapter]]'
tags:
  - agent
  - skills
  - sandcastle
  - command-surface
  - config
  - hitl
---

## Goal

Unify skill-enabling and Sandcastle-enabling behind one deterministic Doc-Vader command surface, so agents call repository-owned commands instead of embedding ad hoc shell snippets, hard-coded template paths, or hand-editing work-management files. First settle the command/API contract, then implement the AFK tracer bullet.

## Background

The `/to-tmpl-prd` skill already expects commands for validating and rendering PRD payloads. Sandcastle's pinned issue tracker registry currently models an issue tracker as a small command surface: list tasks, view one task, close one task, install any required tools, and document any required environment variables. Its Beads integration maps that surface to `bd ready --json`, `bd show <ID>`, and `bd close <ID> --reason="Completed by Sandcastle"`. Doc-Vader must satisfy that registry shape, but Sandcastle incorporation also needs the operational guarantees that make parallel AFK execution safe: claim or lease ownership, readiness gates, evidence recording, and graph traversal or analysis for dependency-aware selection. Durable `owner` and `assignee` fields should remain human-readable accountability fields, while leases should be runtime coordination records with hosted-authority-ready fields such as lease ID, holder identity, token, expiry, heartbeat, branch, sandbox, and recovery state. Beads exposes similar agent workflow primitives through dependency-aware ready selection, claiming, graph links, setup guidance, and JSON output, so those capabilities are MVP scope for Doc-Vader's Sandcastle command surface.

Authoritative references:

- Sandcastle issue tracker registry at `mattpocock/sandcastle@b4230adcb6b65123b576709c44b35ba0c8e250cd`, `src/InitService.ts`, around the issue tracker registry.
- Beads repository and README at `gastownhall/beads`.

## Decision Summary

The user-facing namespace remains Doc-Vader for now, with `dv` as the CLI alias and `dv task` as the Sandcastle-facing resource. Sandcastle is a client of the Doc-Vader command surface, not a namespace inside Doc-Vader. The internal domain can continue using work-item terminology where appropriate, but the CLI should expose task-oriented commands.

Sandcastle-ready work means AFK only. HITL, blocked, unknown, invalid, dependency-blocked, archived, closed, and already-claimed work must fail closed and must not appear in `dv task ready`. Artifact-specific formats may expose their own AFK/HITL classification shape, but Doc-Vader must normalize those values before guard logic runs. Runtime gates may downgrade AFK work to HITL or blocked; they must not upgrade missing, unknown, invalid, or HITL work to AFK.

The claim is the explicit execution lease. A unit of work must be claimed before related execution begins. The claim ID is only a lookup identifier, not an authorization token. Authorization is an environmental concern provided by the local OS/elevation context or by a hosted authority such as OIDC, SAML, or service session metadata. Actor and timestamp values are authority-emitted audit metadata and must not be accepted as caller-supplied mutable payload fields.

Claims are scoped by an immutable, content-addressed scope graph. `reserve` creates, validates, stores, or recovers a scope graph and returns its `scope_hash`; `claim` creates execution ownership against an explicit scope hash. Mutating a scope creates a new scope hash. An active claim keeps its original scope hash, and any work outside that approved graph requires a new claim. Scope lanes such as work, context, and output remain useful for planning, explanation, and future policy, but MVP expansion rules are uniform: any mutation or reservation outside the approved bounding scope fails closed.

Every mutated artifact must be covered by a claim-bound reservation. A write action does not need a separate reservation if it mutates an already-covered artifact. Doc-Vader may auto-reserve on write only when the target artifact resolves inside the approved scope graph and no conflicting claim exists. Evidence capture follows the same generic rule: Doc-Vader core does not special-case evidence records, but any artifact that must be mutated as part of record creation or linkage must be claim-covered.

Claim state must be backend-pluggable. The MVP should include a lightweight local backend under a gitignored `.doc-vader/runtime/` store or equivalent SQLite database, while keeping the record shape ready for hosted authority. Claim TTL defaults to `SANDCASTLE_IDLE_TIMEOUT_SECONDS` plus a grace interval. Explicit claim-context mutation commands renew the claim within policy; read-only commands with an optional claim context can update `last_seen_at` but should not extend `expires_at`. `last_semantic_event` is omitted from MVP.

Revocation requires escalation in local and hosted modes. Local revocation should use host-native authorization such as `sudo`, `runas`, or equivalent elevation; hosted revocation should route through the service authority. The MVP has no non-escalated override and no caller-supplied revocation actor or timestamp.

Section-level and nested artifact claims are out of MVP scope and are tracked by [[60340-artifact-graph-and-nested-claim-architecture-adr]]. Until that ADR lands, claim atomicity remains at the existing file, document, work-item, or adapter-resolved artifact boundary.

## MVP Command Surface

Commands default to human-readable output and support `--json` and `--porcelain` where machine consumers need stable output.

- `dv task ready [--json|--porcelain]` lists AFK, unclaimed, runtime-pass work. It is a named query over the canonical filters and does not mutate claim state.
- `dv task reserve <task-id> [--payload <json-or-file>] [--dry-run] [--json|--porcelain]` creates, validates, stores, or recovers an immutable scope graph and returns a `scope_hash`. It must reject work that is known unclaimable.
- `dv task scopes <task-id> [--json]` lists known stored scope hashes for a task.
- `dv task scope <scope-hash> [--json]` inspects one stored scope graph.
- `dv task scope derive <scope-hash> add <artifact-ref>... [--json]` and `dv task scope derive <scope-hash> remove <artifact-ref>... [--json]` create a new scope graph hash when policy permits; they never mutate the existing graph or an active claim in place.
- `dv task claim <task-id> --scope <scope-hash> [--dry-run] [--json|--porcelain]` creates the execution claim, persists the full claim to the configured store, and prints the claim ID.
- `dv task status --claim <claim-id> [--json]` reports non-sensitive claim status and authority-derived metadata.
- `dv task claim <claim-id> add <artifact-ref>... [--dry-run] [--json|--porcelain]` atomically adds claim-bound artifact reservations only when all refs are inside the approved scope graph and conflict-free.
- `dv task claim <claim-id> remove <artifact-ref>... [--dry-run] [--json|--porcelain]` releases artifact reservations from the claim.
- `dv record create --type <record-type> --payload <json-or-file> [--dry-run] [--json|--porcelain]` creates a generic top-level record resource.
- `dv task record --claim <claim-id> --type <record-type> --payload <json-or-file> [--dry-run] [--json|--porcelain]` creates and links a record inside the claimed task context.
- `dv task close --claim <claim-id> [--dry-run] [--json|--porcelain]` completes the claimed task only after required durable writes and validation gates pass, then releases the claim.
- `dv task release --claim <claim-id> [--dry-run] [--json|--porcelain]` releases the whole claim without closing the task.
- `dv task revoke --claim <claim-id> --reason <text> [--evidence <ref>] [--dry-run] [--json|--porcelain]` revokes a claim through the configured escalation authority.

## User Stories

1. As a skill author, I want Doc-Vader commands for creating, rendering, validating, and progressing configured template-aligned documents, so skills can be thin orchestration layers instead of file-editing scripts.
2. As a Sandcastle planner, I want a machine-readable list of AFK-ready work with dependency metadata, so parallel execution does not pick HITL or blocked items.
3. As a merge agent, I want one safe close/finalize command that records evidence and runs required gates, so completed work items are not closed by partial metadata edits.
4. As a maintainer, I want all agent automation to share the same lifecycle, schema, template, and guardrail rules, so skills and Sandcastle cannot drift.

## What To Build

Evaluate Sandcastle's issue tracker registry as the primary integration surface, using Beads as the reference adapter for expected command semantics. Define the Doc-Vader command/API contract for a shared agent command surface. Then add or complete the CLI commands and library APIs. The first tracer bullet should cover the full Sandcastle MVP: AFK-ready selection, claim or lease ownership, readiness gates, evidence recording, graph traversal or analysis, safe close/finalize behavior, tool install guidance, and environment guidance over the existing work-item surface. Lease storage should be backend-pluggable: hosted-authority-ready for multi-contributor/SaaS execution, with a lightweight local backend such as a gitignored `.doc-vader/runtime/` filesystem or SQLite store for individual use. Lease revocation must require escalation in both local and hosted modes. The MVP local escalation path should rely on host-native authorization mechanisms, such as `sudo` on Unix-like hosts or `runas`/equivalent elevation on Windows; hosted mode should route the same revocation request through the service policy authority. Revocation actor and timestamp must not be caller-supplied fields; they should be audit metadata emitted by the authorizing authority, such as OS user/elevation metadata locally or OIDC/SAML/session claims hosted. User-supplied revocation payload should be limited to reason and optional supporting evidence. A dedicated rich view API can be deferred unless it falls out of the same parsing and serialization path needed by the MVP commands. The broader configured document-suite surface should then cover template-aligned document payload creation, rendering, validation, and lifecycle transition, integrating with [[60333-canonical-schema-profile-routing-and-fixtures]] when extension-pack routing is available. Update `/to-tmpl-prd` usage expectations and Sandcastle prompt wiring to call these commands instead of inline scripts once the commands exist.

Implementation is decomposed into AFK slices:

- [[60341-task-ready-afk-eligibility-query]]
- [[60342-task-scope-reservation-and-lookup]]
- [[60343-task-claim-store-and-lifecycle]]
- [[60344-claim-bound-artifact-reservations]]
- [[60345-claim-aware-record-and-close-commands]]
- [[60346-sandcastle-doc-vader-task-adapter]]

## Acceptance Criteria

- [ ] Sandcastle's pinned issue tracker registry is evaluated as the authoritative adapter shape, including list, view, close, tool installation, and environment example hooks.
- [ ] Doc-Vader's Sandcastle MVP extends the registry shape with claim/lease ownership, readiness gates, evidence recording, and graph traversal or analysis for dependency-aware execution.
- [ ] Doc-Vader can be mapped into Sandcastle with either registry-compatible commands or a small Doc-Vader-aware adapter that preserves Sandcastle's existing issue tracker abstraction.
- [ ] Beads is evaluated as the reference adapter for issue listing, viewing, dependency-aware ready selection, claiming, graph links, JSON output, setup guidance, and closing/finalization.
- [ ] Doc-Vader command/API contract is documented before implementation, including command names, inputs, outputs, status/error shapes, and lifecycle guarantees.
- [ ] Claim/lease semantics keep durable `owner` and `assignee` accountability separate from runtime lease state.
- [ ] Lease persistence is backend-pluggable, with a local lightweight backend and a hosted-authority-ready lease record shape.
- [ ] Active lease revocation requires escalation in local and hosted modes, and actor/timestamp are not accepted as caller-supplied fields.
- [ ] Local lease revocation uses host-native authorization such as `sudo`, `runas`, or an equivalent platform elevation mechanism instead of a self-asserted override flag.
- [ ] Local and hosted lease revocation emit actor/timestamp as audit metadata derived from OS/elevation metadata or service-side identity claims such as OIDC, SAML, or session metadata.
- [ ] The MVP local revocation path is deterministic and auditable without requiring the hosted service to exist.
- [ ] A command can create a PRD JSON payload from explicit structured inputs and report missing required fields without inventing values.
- [ ] A command can create/render/validate another configured document suite, such as ADR management, without source-code changes.
- [ ] A command can render a PRD or other template-aligned work-management document from canonical JSON/template/config inputs with a preserved source payload.
- [ ] A command can validate both content payload and rendered Markdown/frontmatter against the configured schema/template profile.
- [ ] A command can progress a template-aligned document through valid lifecycle/status states using repository transition policy.
- [ ] A Sandcastle-compatible command can list AFK-ready work items as JSON, excluding HITL, closed, archived, blocked, and invalid candidates.
- [ ] A Sandcastle-compatible command can claim or lease one work item atomically enough to prevent concurrent agents from selecting the same item.
- [ ] A Sandcastle-compatible command can evaluate readiness gates for a work item and report blocking policy, dependency, validation, and HITL reasons as structured data.
- [ ] A Sandcastle-compatible command can record implementation evidence independently from final close/finalize.
- [ ] A Sandcastle-compatible command can traverse or analyze the work-item graph for dependency-aware selection and execution planning.
- [ ] A minimal work-item view is available only where needed to support MVP execution; richer view APIs can be deferred to a follow-on unless they are largely overlapping or minimally incremental.
- [ ] A Sandcastle-compatible command can close/finalize a completed work item while preserving Doc-Vader's evidence and validation requirements.
- [ ] Sandcastle prompts can be simplified to call Doc-Vader list, claim/lease, readiness, evidence, graph, and close/finalize commands instead of inline Node scripts.
- [ ] `/to-tmpl-prd` can rely on Doc-Vader create/validate/render/progress commands for deterministic actions.
- [ ] Tests cover the command boundary with representative PRD, work item, AFK/HITL filtering, blocked dependency, and closure-evidence cases.

## Blocked By

HITL decision review is complete for the MVP command surface captured above. This parent remains HITL as the contract record: changes that expand beyond the captured command, claim, scope, AFK, or revocation semantics require renewed human review. The linked AFK execution slices can proceed without reopening the contract.

## Priority Notes

After the API contract is approved, start with the commands needed for Sandcastle incorporation:

1. List AFK-ready work items with status, tags, priority, dependencies, and file metadata.
2. Claim or lease work so concurrent agents do not select the same item.
3. Validate readiness and required gates for a work item branch.
4. Record implementation evidence independently from final close/finalize.
5. Traverse or analyze the work graph for dependency-aware planning.
6. Close/finalize completed work without bypassing backlog policy.
7. Publish tool installation and environment guidance for Sandcastle scaffolding.
8. Replace Sandcastle custom inline Node snippets with these Doc-Vader commands.

Defer richer view APIs to a follow-on unless they are largely overlapping with, or minimally incremental to, the MVP data loading and serialization work.

After Sandcastle is using the structured API, extend the same command surface to `/to-tmpl-prd` and other configured template suites.

## Guardrails

- Do not weaken existing CI, workflow, hook, schema, or backlog validation behavior.
- Do not make Sandcastle select HITL work unless a human explicitly authorizes that mode.
- Do not close work items without evidence and required validation gates.
- Keep hosted SaaS and published GitHub App architecture decisions in [[60338-hosted-saas-github-app-architecture-adr]].
- Keep nested or section-level artifact claims in [[60340-artifact-graph-and-nested-claim-architecture-adr]] until that ADR is complete.
- Do not expand beyond the captured command surface without renewed HITL review.
