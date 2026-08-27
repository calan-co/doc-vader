---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60494
title: Disable CodeRabbit Automatic Pull Request Reviews
summary: Disable automatic CodeRabbit pull-request reviews so the repository requests them only after its independent review-resolve loop is clean.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 1
commits:
  077f88992e251db0d0489b6e2b3f72bb1c49a8f8: 'chore(review): disable automatic CodeRabbit PR reviews'
links:
  reference:
    - '[[60492-add-repository-owned-pr-review-resolve-status-gate]]'
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/83
  evidence:
    - '[[record-20260827-195058-60494]]'
tags:
  - ci
  - review
  - coderabbit
  - quality
---

## Goal

Prevent automatic CodeRabbit `CHANGES_REQUESTED` reviews from blocking pull
requests before the repository's independent review-resolve loop is complete.

## Background

CodeRabbit automatic review currently runs for every pull request. It can record
`CHANGES_REQUESTED` on an earlier head even when all findings are later resolved,
leaving GitHub's review decision blocked. Manual CodeRabbit review remains
available after automatic review is disabled.

## Tasks

- [ ] Set `reviews.auto_review.enabled` to `false` in `.coderabbit.yaml`.
- [ ] Preserve every other CodeRabbit setting, including
  `request_changes_workflow`.
- [ ] Use an explicit CodeRabbit review request only after the independent
  review-resolve loop is clean.

## Deliverables

- CodeRabbit configuration with automatic pull-request review disabled.
- This tracked, nonterminal policy/configuration record.

## Acceptance Criteria

- [ ] `.coderabbit.yaml` sets only `reviews.auto_review.enabled` from `true` to
  `false`.
- [ ] Manual CodeRabbit review remains available.
- [ ] No branch protection, CI workflow, or CodeRabbit
  `request_changes_workflow` setting changes.
- [ ] YAML parsing, documentation lint, backlog validation, CI-grade backlog
  validation, and diff checks pass.

## Rollback

Restore `reviews.auto_review.enabled: true` in a focused reviewed change if
repository policy again requires automatic CodeRabbit review.

## Relationships

- No formal dependencies are currently known; this configuration change can be
  applied independently of the review-evidence implementation work.
