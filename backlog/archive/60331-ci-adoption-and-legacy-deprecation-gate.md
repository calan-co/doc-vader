---
id: wi-60331
title: CI Adoption and Legacy Deprecation Gate
summary: Adopt the unified validation pipeline in developer and CI flows while preserving an explicit maintainer approval boundary for workflow and deprecation policy changes.
type: work-item
subtype: story
lifecycle: active
status: closed
status_reason: obsolete
priority: high
estimated: 5
actual: 0
completed_date: '2026-06-12'
links:
  evidence:
    - '[[record-20260612-backlog-consolidation]]'
    - '[[record-20260612-hosted-app-pivot]]'
  reference:
    - '[[archive/176.1.1.npm-scripts-and-docs-task]]'
    - '[[archive/176.1.ci-and-deprecation-story]]'
    - '[[archive/176.ci-integration-and-deprecation-feature]]'
    - '[[60336-github-app-deployment-and-protected-ci-wiring]]'
tags:
  - ci
  - adoption
  - hitl
  - obsolete
---

## Goal

Move the unified validation pipeline into day-to-day scripts and CI with a clear fallback/deprecation plan that a maintainer can approve before workflow-sensitive changes land.

## User Stories

1. As a maintainer, I want a reviewed CI adoption plan, so that workflow changes do not alter protected validation behavior unexpectedly.
2. As a contributor, I want npm scripts and docs to explain fast and full validation modes, so that I can run the right gate locally.
3. As an automation agent, I want legacy fallback behavior to be explicit, so that deprecation work can proceed without guessing policy.

## What To Build

Update npm scripts, documentation, and CI integration for the unified pipeline, including fast/full modes and one-release legacy fallback behavior. Keep workflow-trigger or required-check changes behind maintainer approval.

## Acceptance Criteria

- [ ] Npm scripts expose the unified validation entrypoints and selected fast/full modes.
- [ ] Documentation explains local and CI validation behavior, fallback behavior, and deprecation timing.
- [ ] CI adoption changes are reviewed against repository safety constraints before merge.
- [ ] Legacy script removal is tracked and does not silently remove the fallback before the approved window.

## Blocked By

Closed as obsolete. The durable architecture direction is the hosted backend and published GitHub App path tracked by [[60336-github-app-deployment-and-protected-ci-wiring]]. Local CI adoption work should only continue as temporary, non-weakening migration support after the hosted-app ADR grants that boundary.

## Closure Notes

- 2026-06-12: Closed as obsolete with evidence in [[record-20260612-hosted-app-pivot]]. Guardrail constraints were preserved in [[60336-github-app-deployment-and-protected-ci-wiring]].

## Supersedes

- [[archive/176.1.1.npm-scripts-and-docs-task]]
- [[archive/176.1.ci-and-deprecation-story]]
- [[archive/176.ci-integration-and-deprecation-feature]]
