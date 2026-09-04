---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60497
title: Refactor lock diagnostic classification from Git and SQLite setup
summary: Isolate pure lock-diagnostic classification coverage while retaining one measured end-to-end Git and SQLite audit contract.
type: work-item
subtype: task
lifecycle: draft
status: draft
priority: medium
estimated: 3
links:
  depends_on:
    - '[[60496-self-hosted-pull-ci-timing-telemetry]]'
  evidence:
    - '[[record-20260830-092324-60497]]'
tags:
  - runtime
  - sqlite
  - git
  - testing
  - performance
---

## Goal

Separate pure lock-diagnostic classification from expensive Git and SQLite fixture setup without weakening end-to-end audit coverage.

## Planned Work

- Extract a pure classifier for missing, foreign-owned, expired, owned, and rename diagnostics.
- Add focused unit tests for the classifier without temporary repositories, Git processes, or SQLite stores.
- Retain one real Git plus SQLite `auditChangedFiles()` contract test.
- Keep SQLite conflict and claim-expiry tests focused on store behavior.

## Acceptance Criteria

- [ ] The classifier has deterministic unit coverage for each lock state and rename handling.
- [ ] One measured real Git and SQLite audit contract remains.
- [ ] Refactoring preserves existing audit API behavior and diagnostics.
- [ ] Timing evidence from [[60496-self-hosted-pull-ci-timing-telemetry]] informs any platform-specific test execution or timeout decision.
