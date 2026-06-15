---
id: wi-60338
title: Hosted SaaS and Published GitHub App Architecture ADR
summary: Decide the full hosted Doc-Vader SaaS architecture, published GitHub App model, configuration authority, extension loading, policy authority semantics, and migration boundaries before implementation slices are created.
type: work-item
subtype: story
lifecycle: active
status: ready
status_reason: auto
priority: high
estimated: 6
links:
  evidence:
    - '[[record-20260612-hosted-app-pivot]]'
    - '[[record-20260612-context-coordination-pivot]]'
  reference:
    - '[[60330-unified-remark-validation-pipeline]]'
    - '[[60332-staging-script-migration-and-archive]]'
    - '[[60333-canonical-schema-profile-routing-and-fixtures]]'
    - '[[60336-github-app-deployment-and-protected-ci-wiring]]'
    - '[[archive/60337-context-coordination-policy-and-ci-seams]]'
tags:
  - hosted
  - saas
  - github
  - app
  - adr
  - config
  - hitl
---

## Goal

Create the architecture decision record for moving Doc-Vader from repository-local automation toward a hosted SaaS backend with a published GitHub App, while preserving repository guardrails and making configuration, extension-loading, and policy authority decisions explicit.

## Background

The previous local CI adoption, release-readiness, and context-coordination HITL slices were closed as obsolete after the durable direction shifted toward a hosted service and published GitHub App. Their implementation concerns are preserved in AFK foundation work, but the full SaaS architecture and authority model still need an active human-reviewed tracker.

## User Stories

1. As a maintainer, I want the hosted-service and published GitHub App architecture approved before implementation, so that repository protections and trust boundaries are not inferred by agents.
2. As a service operator, I want the runtime, tenancy, credentials, webhook, queue, storage, configuration, extension-loading, and status-reporting model defined, so that deployment work can be sliced safely.
3. As a reviewer, I want advisory versus authoritative policy signals, fail-closed behavior, and human approval boundaries documented, so that hosted enforcement cannot silently overreach.
4. As an automation agent, I want a clear migration path from local CLI/CI validation to hosted checks, so that future AFK work is implementation-only.

## What To Decide

Produce an ADR or equivalent decision record that defines the hosted SaaS product boundary, GitHub App publication model, installation scope, permission set, webhook/event model, service runtime, job execution model, configuration source-of-truth, schema/template extension loading model, evidence storage, status/check reporting, policy authority semantics, tenant/repository isolation, credential handling, failure modes, migration phases, and non-weakening repository guardrail constraints.

## Acceptance Criteria

- [ ] ADR states whether Doc-Vader proceeds with a hosted SaaS backend and published GitHub App.
- [ ] Configuration consolidation identifies the authoritative config layers for CLI, CI, Sandcastle, skills, and hosted service execution.
- [ ] Extension loading defines how schema/template packs are discovered, explicitly configured, trusted, cached, and isolated per repository or tenant.
- [ ] GitHub App permissions, installation scope, webhook events, check/status outputs, and repository write behavior are explicit.
- [ ] Hosted enforcement authority distinguishes authoritative, advisory, fail-closed, and human-approved policy decisions.
- [ ] Evidence, provenance, alias migration, and conflict-seam behavior have trust boundaries suitable for hosted execution.
- [ ] Migration plan explains how current local CLI/CI validation is preserved, complemented, or replaced without weakening existing guardrails.
- [ ] Follow-up AFK implementation work items can be created from the ADR without reopening architecture or security decisions.
- [ ] Protected repository settings, workflow triggers, workflow permissions, secrets, bypass actors, and required checks remain HITL until explicitly approved in the implementing turn.

## Blocked By

HITL: maintainer architecture approval for hosted SaaS scope, published GitHub App publication, policy authority, service trust boundaries, and migration constraints.

## Dependency Notes

This ADR has no active implementation dependency. It should block future hosted-service implementation slices, while existing AFK foundation work remains portable and can continue:

- [[60330-unified-remark-validation-pipeline]]
- [[60332-staging-script-migration-and-archive]]
- [[60333-canonical-schema-profile-routing-and-fixtures]]

## Traceability

- Supersedes the active decision-tracking role previously carried by [[60336-github-app-deployment-and-protected-ci-wiring]].
- Preserves the hosted authority questions recorded from [[archive/60337-context-coordination-policy-and-ci-seams]].
