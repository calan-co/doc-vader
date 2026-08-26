---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60489
title: Enforce Staging Integration and Merge Debt at Claim Start
summary: Require verified staging delivery for declared prerequisites and deny new dependent execution when tracked Work-Item delivery debt reaches three.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 5
links:
  depends_on:
    - '[[60488-add-provider-neutral-delivery-facts]]'
  evidence:
    - '[[record-20260826-171242-60489]]'
tags:
  - claims
  - dependencies
  - delivery
  - policy
---

## Goal

Use the existing claimability seam to prevent dependent execution from outrunning verified staging integration or accumulating debt from three or more distinct tracked Work Items whose normalized delivery facts confirm effective staging delivery and absence from main.

## Background

The current dependency predicate uses local terminal state only. Under
post-main completion, a prerequisite intentionally remains nonterminal after
staging delivery, so ordinary execution claims need a separate, verified
integration-readiness decision without changing authored dependency display or
lint semantics.

## Tasks

- [ ] Require verified staging delivery for every declared prerequisite at ordinary execution-claim acquisition.
- [ ] Adapt the shared ordinary execution-claim path to evaluate declared-prerequisite integration readiness from verified staging delivery rather than local terminal state; retain local dependency state for display and lint.
- [ ] Count each distinct tracked Work Item once only when its normalized linked implementation pull-request delivery facts confirm effective staging delivery and absence from main.
- [ ] Exclude reverted, missing, or ambiguous delivery facts from merge-debt counts and fail closed for claimability when those facts are required.
- [ ] Deny execution claims at a debt count of three with structured blocking records through both CLI and library paths.

## Deliverables

- Shared integration-readiness and capped merge-debt claim policy.
- Claim-path regression coverage and operational diagnostics.

## Acceptance Criteria

- [ ] A locally completed prerequisite without verified staging delivery denies the dependent claim before a claim or lock is written.
- [ ] A declared prerequisite with verified staging delivery satisfies the ordinary execution-claim integration-readiness gate even while its local Work Item remains nonterminal; existing dependency display and lint semantics remain unchanged.
- [ ] Verified staging prerequisites below the cap allow ordinary execution claims.
- [ ] A debt count of three distinct tracked Work Items blocks new dependent execution with auditable blocking records, regardless of how many linked implementation pull requests each Work Item has.
- [ ] Reverted, missing, or ambiguous delivery facts are excluded from merge-debt counts and fail closed for claimability when required; a regression fixture covers a reverted staging merge that remains absent from main.
- [ ] Direct library claim paths cannot bypass the policy.
