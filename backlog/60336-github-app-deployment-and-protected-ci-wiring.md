---
id: wi-60336
title: GitHub App Deployment and Protected CI Wiring
summary: Decide the hosted-service and published GitHub App architecture, including protected CI integration, migration constraints, and non-weakening guardrail boundaries.
type: work-item
subtype: story
lifecycle: active
status: closed
status_reason: completed
priority: high
estimated: 5
completed_date: '2026-06-12'
links:
  evidence:
    - '[[record-20260612-backlog-consolidation]]'
    - '[[record-20260612-hosted-app-pivot]]'
    - '[[record-20260612-framework-readiness-pivot]]'
    - '[[record-20260612-context-coordination-pivot]]'
  reference:
    - '[[archive/234.github-app-deployment-and-ci-plan-story]]'
    - '[[archive/60331-ci-adoption-and-legacy-deprecation-gate]]'
    - '[[archive/60334-framework-reconciliation-and-release-readiness-decisions]]'
    - '[[archive/60337-context-coordination-policy-and-ci-seams]]'
tags:
  - github
  - app
  - deployment
  - hitl
---

## Goal

Provide the reviewed architecture and release-readiness decision for moving Doc-Vader toward a hosted backend and published GitHub App without weakening branch protection, secrets, required checks, workflow permissions, or bypass policy.

## User Stories

1. As a maintainer, I want the hosted-service and published-app architecture reviewed before implementation, so that repository protections are preserved.
2. As an automation operator, I want app identity, credentials, installation scope, service responsibilities, and workflow usage documented, so that automation runs under the intended trust model.
3. As a reviewer, I want protected-branch, required-check, workflow-permission, and migration implications called out, so that approval decisions are explicit.
4. As a contributor, I want any interim local CI/script changes identified as temporary and non-weakening, so that short-term work does not become the accidental architecture.
5. As a release owner, I want release-readiness and branch-cut criteria tied to the chosen architecture, so that release decisions are not separated from the deployment model.

## What To Build

Create the ADR or equivalent decision record for the Doc-Vader hosted backend and published GitHub App. The decision must define the service boundary, GitHub App permission model, installation and credential handling, status/check reporting, evidence generation, policy authority model, fallback behavior, migration sequence, release-readiness gate, branch-cut criteria, and which interim repository-local CI/script changes are allowed before the hosted path is implemented.

## Acceptance Criteria

- [ ] ADR or equivalent decision record defines whether Doc-Vader proceeds with a hosted backend plus published GitHub App.
- [ ] Service responsibilities, GitHub App permissions, installation scope, credential handling, status/check reporting, evidence generation, and fallback behavior are documented.
- [ ] Hosted enforcement authority defines which policy/evidence signals are authoritative, advisory, fail-closed, or human-approved.
- [ ] Migration plan explains how current repo-local CI validation is preserved, replaced, or complemented by the app without weakening existing gates.
- [ ] Release-candidate scope, validation commands, documentation gates, and branch-cut decision process are explicit for the selected deployment model.
- [ ] Interim npm-script or workflow changes are limited to explicitly approved, temporary, non-weakening steps that move toward the hosted-app architecture.
- [ ] Branch protection, ruleset, required-check, bypass actor, workflow trigger, workflow permission, and secret changes are explicitly marked as HITL approvals.
- [ ] No protected repository setting or guardrail implementation is changed without written approval in the implementing turn.

## Blocked By

HITL: maintainer architecture approval for hosted service, published GitHub App, migration boundaries, and any repository-control or guardrail-surface changes.

## Supersedes

- [[archive/234.github-app-deployment-and-ci-plan-story]]
- [[archive/60331-ci-adoption-and-legacy-deprecation-gate]]
- [[archive/60334-framework-reconciliation-and-release-readiness-decisions]]
- [[archive/60337-context-coordination-policy-and-ci-seams]]

- 2026-06-12: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.
