---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60489
title: Enforce Staging Integration And Merge Debt At Claim Start
summary: Require verified staging delivery for declared prerequisites and deny new dependent execution when tracked Work-Item delivery debt reaches three.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 5
links:
  depends_on:
    - '[[60488-add-provider-neutral-delivery-facts.md]]'
tags:
  - claims
  - dependencies
  - delivery
  - policy
---

## Goal

Use the existing claimability seam to prevent dependent execution from outrunning verified staging integration or accumulating more than three tracked Work Items merged to staging but not main.

## Tasks

- [ ] Require verified staging delivery for every declared prerequisite at ordinary execution-claim acquisition.
- [ ] Count tracked Work-Item-linked implementation pull requests merged to staging but not main.
- [ ] Deny execution claims at a debt count of three with structured blocking records through both CLI and library paths.

## Deliverables

- Shared integration-readiness and capped merge-debt claim policy.
- Claim-path regression coverage and operational diagnostics.

## Acceptance Criteria

- [ ] A locally completed prerequisite without verified staging delivery denies the dependent claim before a claim or lock is written.
- [ ] Verified staging prerequisites below the cap allow ordinary execution claims.
- [ ] A debt count of three blocks new dependent execution with auditable blocking records.
- [ ] Direct library claim paths cannot bypass the policy, and existing frontmatter dependency display and lint semantics remain unchanged.
