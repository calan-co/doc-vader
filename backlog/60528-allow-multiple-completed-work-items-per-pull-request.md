---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60528
title: Allow Multiple Completed Work Items Per Pull Request
summary: Bootstrap a reviewed multi-item completion gate while retaining fail-closed validation for every linked Work Item.
type: work-item
subtype: task
lifecycle: active
status: running
status_reason: implementation
priority: high
links:
  reference:
    - https://github.com/calan-co/doc-vader/pull/130
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

- [ ] Integrate the already-reviewed validation dependencies without weakening gates.
- [ ] Add failing coverage for multiple completed items and mixed valid/invalid associations.
- [ ] Validate every linked Work Item while continuing to reject zero matches.
- [ ] Run focused and full tests, documentation/backlog checks, and pre-push validation.
- [ ] Record genuine prospective-claim evidence and obtain independent review.

## Acceptance Criteria

- [ ] One or more fully completed linked Work Items pass the implementation gate.
- [ ] Zero linked items and any incomplete linked item fail.
- [ ] Every linked item retains the existing checklist, evidence, date, and effort checks.
- [ ] Documentation-only behavior, YAML-only parsing, and protected CI enforcement remain unchanged.
