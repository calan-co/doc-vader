---
id: wi-60339
title: Agent Command Surface for Skills and Sandcastle
summary: Shape and then implement deterministic Doc-Vader CLI commands for configured template-aligned document creation, rendering, validation, state progression, issue selection, and closure so skills and Sandcastle use the same safe automation surface.
type: work-item
subtype: story
lifecycle: active
status: paused
status_reason: blocked
priority: critical
estimated: 8
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/61
    - https://github.com/calan-co/doc-vader/pull/62
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
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
    - '[[60377-work-item-governance-kernel]]'
  evidence:
    - '[[record-20260614-164457-60339]]'
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
- Architecture ADRs: `docs/architecture/decisions/adr-005-entity-governance-primitive-model.md`, `docs/architecture/decisions/adr-006-task-command-surface-work-item-canonical-model.md`, `docs/architecture/decisions/adr-007-local-runtime-authority-git-sqlite.md`, and `docs/architecture/decisions/adr-009-storage-and-format-seams.md`.

## Decision Summary

The user-facing namespace remains Doc-Vader for now, with `dv` as the CLI alias and `dv task` as the Sandcastle-facing resource. Sandcastle is a client of the Doc-Vader command surface, not a namespace inside Doc-Vader. The internal domain can continue using work-item terminology where appropriate, but the CLI should expose task-oriented commands.

Sandcastle-ready work means AFK only. HITL, blocked, unknown, invalid, dependency-blocked, archived, closed, and already-claimed work must fail closed and must not appear in `dv task ready`. Artifact-specific formats may expose their own AFK/HITL classification shape, but Doc-Vader must normalize those values before guard logic runs. Runtime gates may downgrade AFK work to HITL or blocked; they must not upgrade missing, unknown, invalid, or HITL work to AFK.

The claim is the explicit execution lease. A unit of work must be claimed before related execution begins. The claim token is only a lookup identifier, not an authorization token. Authorization is an environmental concern provided by the local OS/elevation context or by a hosted authority such as OIDC, SAML, or service session metadata. Actor and timestamp values are authority-emitted audit metadata and must not be accepted as caller-supplied mutable payload fields.

The MVP claim boundary is the Work Item target plus claim-owned repo-relative file locks. Claims, locks, and execution-log entries live in the Git plus SQLite runtime authority from [[60361-git-sqlite-local-multi-agent-runtime-contract]]. Scope graphs, scope hashes, and claim-bound artifact reservations are deferred beyond MVP; paused scope-graph items remain historical/future design inputs and must not block the runtime spine.

Every mutated file artifact must be covered by a claim-owned lock. Evidence capture follows the same generic rule: Doc-Vader core does not special-case evidence records, but any file mutated as part of record creation or linkage must be lock-covered by the active claim.

Claim state must be storage-adapter-backed. The MVP local storage adapter is SQLite under the configured Doc-Vader runtime directory; durable work items and records remain Git-managed Markdown/YAML or JSON format-adapter outputs. Claim TTL defaults to `SANDCASTLE_IDLE_TIMEOUT_SECONDS` plus a grace interval. Explicit claim-context mutation commands renew the claim within policy; read-only commands with an optional claim context can update `last_seen_at` but should not extend `expires_at`. `last_semantic_event` is omitted from MVP.

Revocation requires escalation in local and hosted modes. Local revocation should use host-native authorization such as `sudo`, `runas`, or equivalent elevation; hosted revocation should route through the service authority. The MVP has no non-escalated override and no caller-supplied revocation actor or timestamp.

Section-level and nested artifact claims are out of MVP scope and are tracked by [[60340-artifact-graph-and-nested-claim-architecture-adr]]. Until that ADR lands, claim atomicity remains at the existing file, document, work-item, or adapter-resolved artifact boundary.

## MVP Command Surface

Commands default to human-readable output and support `--json` and `--porcelain` where machine consumers need stable output.

- `dv task ready [--json|--porcelain]` lists AFK work using Work Item Markdown plus the latest execution-log entry. It does not hydrate live claim or lock rows during normal ready selection and does not mutate claim state.
- `dv task claim <task-id> [--dry-run] [--json|--porcelain]` creates the execution claim, persists the full claim to the configured runtime store, appends a bounded `running/started` execution-log entry, and prints the claim token.
- `dv claim` and `dv claim status <claim-token> [--json]` report non-sensitive claim status and authority-derived metadata.
- `dv lock add --claim <claim-token> <path>... [--dry-run] [--json|--porcelain]` atomically adds claim-owned file locks after repo-relative path normalization and conflict checks.
- `dv lock rm --claim <claim-token> <path>... [--dry-run] [--json|--porcelain]` removes claim-owned file locks.
- `dv record create --type <record-type> --payload <json-or-file> [--dry-run] [--json|--porcelain]` creates a generic top-level record resource.
- `dv task record --claim <claim-id> --type <record-type> --payload <json-or-file> [--dry-run] [--json|--porcelain]` creates and links a record inside the claimed task context.
- `dv claim complete <claim-token> [--dry-run] [--json|--porcelain]` completes the claimed task only after required durable writes and validation gates pass, then removes claim-owned runtime rows.
- There is no standalone `dv task release` or `dv claim release`; cleanup is internal to terminal transitions or explicit `dv claim prune`/`dv claim rm`.
- `dv claim halt <claim-token> --reason revoked` represents claim revocation through the configured authority path.

## User Stories

1. As a skill author, I want Doc-Vader commands for creating, rendering, validating, and progressing configured template-aligned documents, so skills can be thin orchestration layers instead of file-editing scripts.
2. As a Sandcastle planner, I want a machine-readable list of AFK-ready work with dependency metadata, so parallel execution does not pick HITL or blocked items.
3. As a merge agent, I want one safe close/finalize command that records evidence and runs required gates, so completed work items are not closed by partial metadata edits.
4. As a maintainer, I want all agent automation to share the same lifecycle, schema, template, and guardrail rules, so skills and Sandcastle cannot drift.

## What To Build

Evaluate Sandcastle's issue tracker registry as the primary integration surface, using Beads as the reference adapter for expected command semantics. Define the Doc-Vader command/API contract for a shared agent command surface. Then add or complete the CLI commands and library APIs. The first tracer bullet should cover the full Sandcastle MVP: AFK-ready selection, claim ownership, file-lock ownership, readiness gates, evidence recording, minimal dependency-aware selection, safe completion behavior, tool install guidance, and environment guidance over the existing Work Item surface. Runtime storage should be backend-pluggable: hosted-authority-ready for multi-contributor/SaaS execution, with SQLite as the local MVP storage adapter. Lease revocation must require escalation in both local and hosted modes. The MVP local escalation path should rely on host-native authorization mechanisms, such as `sudo` on Unix-like hosts or `runas`/equivalent elevation on Windows; hosted mode should route the same revocation request through the service policy authority. Revocation actor and timestamp must not be caller-supplied fields; they should be audit metadata emitted by the authorizing authority, such as OS user/elevation metadata locally or OIDC/SAML/session claims hosted. User-supplied revocation payload should be limited to reason and optional supporting evidence. A dedicated rich view API can be deferred unless it falls out of the same parsing and serialization path needed by the MVP commands. The broader configured document-suite surface should then cover template-aligned document payload creation, rendering, validation, and lifecycle transition, integrating with [[60333-canonical-schema-profile-routing-and-fixtures]] when extension-pack routing is available. Update `/to-tmpl-prd` usage expectations and Sandcastle prompt wiring to call these commands instead of inline scripts once the commands exist.

Implementation is decomposed into AFK slices:

- [[60341-task-ready-afk-eligibility-query]]
- [[60363-runtime-entity-schemas]]
- [[60362-runtime-sqlite-store-and-migrations]]
- [[60373-claim-command-surface]]
- [[60374-lock-command-surface]]
- [[60375-lock-path-normalization-and-rename-gate]]
- [[60345-claim-aware-record-and-close-commands]]
- [[60346-sandcastle-doc-vader-task-adapter]]

## Acceptance Criteria

- [ ] Sandcastle's pinned issue tracker registry is evaluated as the authoritative adapter shape, including list, view, close, tool installation, and environment example hooks.
- [ ] Doc-Vader's Sandcastle MVP extends the registry shape with claim ownership, file-lock ownership, readiness gates, evidence recording, and dependency-aware execution metadata.
- [ ] Doc-Vader can be mapped into Sandcastle with either registry-compatible commands or a small Doc-Vader-aware adapter that preserves Sandcastle's existing issue tracker abstraction.
- [ ] Beads is evaluated as the reference adapter for issue listing, viewing, dependency-aware ready selection, claiming, graph links, JSON output, setup guidance, and closing/finalization.
- [ ] Doc-Vader command/API contract is documented before implementation, including command names, inputs, outputs, status/error shapes, and lifecycle guarantees.
- [ ] Claim/lease semantics keep durable `owner` and `assignee` accountability separate from runtime lease state.
- [ ] Runtime persistence is adapter-backed, with SQLite as the local MVP storage adapter and a hosted-authority-ready record shape.
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
- [ ] A Sandcastle-compatible command can expose enough dependency metadata for dependency-aware selection and execution planning without implementing a full Work Graph engine in MVP.
- [ ] A minimal work-item view is available only where needed to support MVP execution; richer view APIs can be deferred to a follow-on unless they are largely overlapping or minimally incremental.
- [ ] A Sandcastle-compatible command can close/finalize a completed work item while preserving Doc-Vader's evidence and validation requirements.
- [ ] Sandcastle prompts can be simplified to call Doc-Vader list, claim, lock, readiness, evidence, and completion commands instead of inline Node scripts.
- [ ] `/to-tmpl-prd` can rely on Doc-Vader create/validate/render/progress commands for deterministic actions.
- [ ] Tests cover the command boundary with representative PRD, work item, AFK/HITL filtering, blocked dependency, and closure-evidence cases.

## Blocked By

HITL decision review is complete for the MVP command surface captured above. This parent remains HITL as the contract record: changes that expand beyond the captured command, claim, scope, AFK, or revocation semantics require renewed human review. The linked AFK execution slices can proceed without reopening the contract.

## Priority Notes

After the API contract is approved, start with the commands needed for Sandcastle incorporation:

1. List AFK-ready work items with status, tags, priority, dependencies, and file metadata.
2. Claim work and acquire file locks so concurrent agents do not select or mutate conflicting items.
3. Validate readiness and required gates for a work item branch.
4. Record implementation evidence independently from final close/finalize.
5. Expose minimal dependency metadata for dependency-aware planning.
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
