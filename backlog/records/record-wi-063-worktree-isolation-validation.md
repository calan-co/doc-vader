---
$schema: schemas/work-management/frontmatter/record.json
id: record:wi-063-worktree-isolation-validation
title: Work record worktree isolation validation
summary: Evidence for Vitae WI-063 and TTR ttr-0494f1e6-45e1-4242-9822-fc6e18c4e03b.
type: record
subtype: test-result
lifecycle: active
status: ready
status_reason: recorded
links:
  supporting_reference:
    - '[[063-fix-work-record-worktree-isolation]]'
---

## Recorded At

2026-11-06T00:28:25Z

## Outcome

pass

## Observation

A public `dv work record --worktree` regression creates and links claim-scoped evidence only in a clean selected Git worktree. The full task command test file and TypeScript typecheck passed.
