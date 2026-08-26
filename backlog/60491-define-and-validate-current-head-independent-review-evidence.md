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
    - '[[../docs/reference/work-management/foundation.md]]'
  evidence:
    - '[[record-20260826-171242-60491]]'
tags:
  - review
  - evidence
  - policy
  - quality
---

## Goal

Create a reusable, deterministic evaluator that keeps independent review-resolve pressure on every pull request rather than only salvage work.

## Background

Current PR CI has no repository-owned evidence that independently performed
review lanes assessed the current head. Fresh SHA binding alone cannot prove
reviewer independence, and a missing Copilot review is not evidence of a clean
review.

## Tasks

- [ ] Define a trusted provenance and independence policy for current-head and base-SHA-bound correctness, regression/tests, architecture-policy, and diff-hygiene lane reports without selecting an unsupported attestation mechanism prematurely.
- [ ] Define validation for missing, stale, untrusted, non-independent, unresolved, and clean reports without claiming to automate reviewer judgment.
- [ ] Require a completed current-head Copilot review outcome and resolved current-head Copilot findings; classify CodeRabbit unavailability distinctly from a clean review.

## Deliverables

- Review-evidence policy and deterministic evaluator.
- Current-head evidence fixtures and regression tests.

## Acceptance Criteria

- [ ] Missing review lanes, stale head/base SHAs, untrusted or non-independent provenance, and unresolved findings fail evaluation.
- [ ] Four current-head clean lane reports with valid trusted provenance and independence evidence pass evaluation.
- [ ] Missing or non-final current-head Copilot review facts fail evaluation, and a current-head Copilot finding blocks until its review thread is resolved.
- [ ] CodeRabbit unavailability is represented distinctly from a clean review result.
