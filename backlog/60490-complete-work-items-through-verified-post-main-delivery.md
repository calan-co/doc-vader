---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60490
title: Complete Work Items Through Verified Post-Main Delivery
summary: Keep implementation Work Items nonterminal through staging and complete them only through policy-authorized automation after verified main delivery.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 5
links:
  depends_on:
    - '[[60487-make-backlog-auto-close-branch-aware.md]]'
    - '[[60488-add-provider-neutral-delivery-facts.md]]'
tags:
  - backlog-automation
  - completion
  - delivery
  - policy
---

## Goal

Perform terminal Work Item completion only after provider-backed verification that the linked implementation has reached main.

## Tasks

- [ ] Keep feature and staging delivery nonterminal while retaining linked PR and evidence facts.
- [ ] Add policy-authorized post-main automation that verifies current main ancestry before terminal completion.
- [ ] Preserve existing qualifier, evidence, actual-if-estimated, lifecycle, and authority gates.

## Deliverables

- Verified post-main terminalization automation.
- Terminalization and reverted-merge regression coverage.

## Acceptance Criteria

- [ ] A feature or staging pull request cannot self-terminalize a linked Work Item merely by merging or linking evidence.
- [ ] Post-main automation completes a Work Item only after verified current-main ancestry and all existing terminal gates pass.
- [ ] A reverted main merge is ineligible for terminalization.
- [ ] Existing terminal metadata and evidence requirements remain enforced.
