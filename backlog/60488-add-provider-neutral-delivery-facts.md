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
links:
  depends_on:
    - '[[60487-make-backlog-auto-close-branch-aware.md]]'
tags:
  - backlog-automation
  - provider
  - delivery
---

## Goal

Provide a forge-neutral delivery-fact contract for Work-Item-linked pull requests before delivery policy relies on remote branch state.

## Tasks

- [ ] Define provider-neutral merged state, base ref, merge SHA, and configured-ref ancestry facts.
- [ ] Implement GitHub-provider extraction and normalized failure handling.
- [ ] Fail closed for missing, ambiguous, unauthenticated, reverted, or non-contained delivery facts.

## Deliverables

- Provider-neutral delivery-fact contract and GitHub adapter.
- Provider contract fixtures and regression coverage.

## Acceptance Criteria

- [ ] A delivery fact exposes merged state, base ref, merge SHA, and configured-ref ancestry without exposing GitHub-specific policy to consumers.
- [ ] Main and staging ancestry are distinguished, and a reverted merge is ineligible for delivery policy.
- [ ] Missing, ambiguous, and unauthenticated provider facts fail closed with actionable diagnostics.
