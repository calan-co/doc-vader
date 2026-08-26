---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60491
title: Define And Validate Current-Head Independent Review Evidence
summary: Define a deterministic current-head review-evidence evaluator for ongoing correctness, regression, architecture-policy, and diff-hygiene review lanes.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 5
links:
  reference:
    - '[[../docs/reference/work-management/policy-seams.md]]'
tags:
  - review
  - evidence
  - policy
  - quality
---

## Goal

Create a reusable, deterministic evaluator that keeps independent review-resolve pressure on every pull request rather than only salvage work.

## Tasks

- [ ] Define current-head and base-SHA-bound evidence for correctness, regression/tests, architecture-policy, and diff-hygiene review lanes.
- [ ] Distinguish missing, stale, unresolved, and clean reports without claiming to automate reviewer judgment.
- [ ] Require current-head Copilot findings to be resolved and classify CodeRabbit unavailability distinctly from a clean review.

## Deliverables

- Review-evidence policy and deterministic evaluator.
- Current-head evidence fixtures and regression tests.

## Acceptance Criteria

- [ ] Missing review lanes, stale head/base SHAs, and unresolved findings fail evaluation.
- [ ] Four current-head clean lane reports pass evaluation.
- [ ] A current-head Copilot finding blocks until its review thread is resolved.
- [ ] CodeRabbit unavailability is represented distinctly from a clean review result.
