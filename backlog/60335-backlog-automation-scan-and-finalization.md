---
id: wi-60335
title: Backlog Automation Scan and Finalization
summary: Deliver provider-backed backlog scanning, subject resolution, evidence generation, and explicit work-item mutation/finalization commands as one automation slice.
type: work-item
subtype: story
lifecycle: active
status: in-progress
status_reason: investigation
priority: high
estimated: 8
commits:
  ebc011c73c333729b7ea4ae7ba95810c3f1272a0: 'chore(backlog): consolidate active work item backlog'
links:
  evidence:
    - '[[record-20260612-backlog-consolidation]]'
    - '[[record-20260612-context-coordination-pivot]]'
  reference:
    - '[[archive/210.vendor-adapter-and-scan-lifecycle-epic]]'
    - '[[archive/210.1.vendor-adapter-and-scan-lifecycle-feature]]'
    - '[[archive/225.story-require-all-linked-prs-merged-for-finalization]]'
    - '[[archive/226.story-add-subject-aware-pr-closure-api]]'
    - '[[archive/240-policy-evidence-and-alias-integrity]]'
    - '[[archive/242-integration-seam-contract-for-concurrent-conflict-ci]]'
    - '[[archive/60337-context-coordination-policy-and-ci-seams]]'
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/60
tags:
  - backlog
  - automation
  - scan
  - afk
---

## Goal

Deliver backlog automation as one provider-backed workflow: scan events, resolve subjects, generate evidence, and mutate/finalize work items through explicit atomic commands.

## User Stories

1. As a maintainer, I want scan reports to explain all evidence-generation decisions, so that automation failures are debuggable.
2. As an automation agent, I want subject-aware work-item commands, so that PR closure and workflow-run ingestion do not rely on synthetic payload guesses.
3. As a repository owner, I want finalization to require all linked PRs merged, so that automation does not close unfinished work.

## What To Build

Implement the provider abstraction, subject resolver chain, scan executor/reporter, optional evidence generation, explicit work-item mutation commands, linked-PR finalization policy, conservative policy/evidence provenance, and deterministic conflict-seam reporting.

## Acceptance Criteria

- [ ] Provider abstraction and GitHub provider support payload parsing, PR identity, metadata, and normalized references.
- [ ] Subject resolver chain supports payload tokens and linked PR fallback with clear failure diagnostics.
- [ ] Backlog scan produces text and JSON reports and can optionally generate evidence records.
- [ ] Work-item link, commit record, refresh/finalize commands are idempotent and explicit-subject based.
- [ ] Finalization is blocked until all linked PRs are merged or policy explicitly says otherwise.
- [ ] Evidence and alias provenance preserve advisory versus authoritative state without silently escalating trust.
- [ ] Conflict seam reporting covers overlap, dependency violation, and policy-blocked transitions with deterministic outcomes.
- [ ] Tests cover scan decisions, resolver ordering, evidence creation, and finalization policy.

## Blocked By

None - can start immediately.

## Supersedes

- [[archive/210.vendor-adapter-and-scan-lifecycle-epic]]
- [[archive/210.1.vendor-adapter-and-scan-lifecycle-feature]]
- [[archive/225.story-require-all-linked-prs-merged-for-finalization]]
- [[archive/226.story-add-subject-aware-pr-closure-api]]
- [[archive/240-policy-evidence-and-alias-integrity]]
- [[archive/242-integration-seam-contract-for-concurrent-conflict-ci]]
- [[archive/60337-context-coordination-policy-and-ci-seams]]

## Status Notes

- 2026-06-12: Consolidation evidence is recorded in backlog/audit/auditing-backlog-report.json; implementation remains in progress until the acceptance criteria above are complete.
