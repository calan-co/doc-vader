---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60528
title: Allow Multiple Completed Work Items Per Pull Request
summary: Bootstrap a reviewed multi-item completion gate while retaining fail-closed validation for every linked Work Item.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
completed_date: '2026-11-10'
links:
  reference:
    - https://github.com/calan-co/doc-vader/pull/130
  evidence:
    - '[[record-wi-60528-policy-validation-20261110]]'
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/131
tags:
  - afk
  - governance
  - validation
---

## Goal

Allow an implementation pull request to link one or more Work Items only when
every linked item satisfies the existing completion and checklist requirements.
The required gate executes trusted-base code, so this policy must land through
a separate, single-item bootstrap PR before the multi-item PR can use it.

## Scope

Import the already-approved schema-loading, historical-evidence URL, audit-base,
and minimal baseline metadata repairs needed for trustworthy validation. Their
original implementation predates this bootstrap effort. Keep the hook change
and the WI-60523/WI-60527 delivery records in PR 130.

## Tasks

- [x] Integrate the already-reviewed validation dependencies without weakening gates.
- [x] Add failing coverage for multiple completed items and mixed valid/invalid associations.
- [x] Validate every linked Work Item while continuing to reject zero matches.
- [x] Run focused and full tests, documentation/backlog checks, and pre-push validation.
- [x] Record genuine prospective-claim evidence and obtain independent review.

## Acceptance Criteria

- [x] One or more fully completed linked Work Items pass the implementation gate.
- [x] Zero linked items and any incomplete linked item fail.
- [x] Every linked item retains the existing checklist, evidence, date, and effort checks.
- [x] Documentation-only behavior, YAML-only parsing, and protected CI enforcement remain unchanged.
