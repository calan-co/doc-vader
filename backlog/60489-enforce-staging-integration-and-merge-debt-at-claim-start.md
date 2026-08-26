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

Use the existing claimability seam to prevent dependent execution from outrunning verified staging integration or accumulating debt from three or more tracked Work Items merged to staging but not main.

## Background

The current dependency predicate uses local terminal state only. Under
post-main completion, a prerequisite intentionally remains nonterminal after
staging delivery, so ordinary execution claims need a separate, verified
integration-readiness decision without changing authored dependency display or
lint semantics.

## Tasks

- [ ] Require verified staging delivery for every declared prerequisite at ordinary execution-claim acquisition.
- [ ] Adapt the shared ordinary execution-claim path to evaluate declared-prerequisite integration readiness from verified staging delivery rather than local terminal state; retain local dependency state for display and lint.
- [ ] Count each tracked Work Item once when its linked implementation pull-request facts prove it is merged to staging but not main.
- [ ] Deny execution claims at a debt count of three with structured blocking records through both CLI and library paths.

## Deliverables

- Shared integration-readiness and capped merge-debt claim policy.
- Claim-path regression coverage and operational diagnostics.

## Acceptance Criteria

- [ ] A locally completed prerequisite without verified staging delivery denies the dependent claim before a claim or lock is written.
- [ ] A declared prerequisite with verified staging delivery satisfies the ordinary execution-claim integration-readiness gate even while its local Work Item remains nonterminal; existing dependency display and lint semantics remain unchanged.
- [ ] Verified staging prerequisites below the cap allow ordinary execution claims.
- [ ] A debt count of three distinct tracked Work Items blocks new dependent execution with auditable blocking records, regardless of how many linked implementation pull requests each Work Item has.
- [ ] Direct library claim paths cannot bypass the policy.
