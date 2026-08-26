---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60488
title: Add Provider-Neutral Delivery Facts
summary: Expose verified pull-request delivery facts needed to prove staging integration and main delivery without coupling policy to GitHub.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 5
tags:
  - backlog-automation
  - provider
  - delivery
---

## Goal

Provide a forge-neutral delivery-fact contract for Work-Item-linked pull requests before delivery policy relies on remote branch state.

## Background

Existing provider metadata does not expose the base ref or configured-ref
ancestry needed for delivery policy. Those facts must be provider-neutral so
claim and completion policy do not depend on GitHub-specific fields.

## Tasks

- [ ] Define provider-neutral merged state, base ref, merge SHA, configured-ref ancestry, and effective-delivery/reversion facts or detection rules.
- [ ] Implement GitHub-provider extraction and normalized failure handling.
- [ ] Fail closed for missing, ambiguous, unauthenticated, reverted, or non-contained delivery facts.

## Deliverables

- Provider-neutral delivery-fact contract and GitHub adapter.
- Provider contract fixtures and regression coverage, including effective-delivery/reversion behavior.

## Acceptance Criteria

- [ ] A delivery fact exposes merged state, base ref, merge SHA, configured-ref ancestry, and effective-delivery/reversion outcome without exposing GitHub-specific policy to consumers.
- [ ] Main and staging ancestry are distinguished, and effective delivery remains ineligible when the merged change was reverted.
- [ ] Regression fixtures cover a reverted merge that must not qualify for delivery policy.
- [ ] Missing, ambiguous, and unauthenticated provider facts fail closed with actionable diagnostics.
