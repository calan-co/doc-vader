---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-063
title: Fix Work Record Worktree Isolation
summary: Keep claim-scoped evidence recording inside its selected worktree.
type: work-item
subtype: bug
lifecycle: active
status: completed
status_reason: completed
priority: high
completed_date: '2026-11-06'
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/128
  evidence:
    - '[[record-wi-063-worktree-isolation-validation]]'
  reference:
    - '[[60345-claim-aware-record-and-close-commands]]'
tags:
  - worktree
  - records
  - regression
---

## Tasks

- [x] Reproduce the missing `dv work record --worktree` public CLI path with a clean Git worktree.
- [x] Add the public regression and route record operations through the selected worktree root.
- [x] Run focused and command-surface regression tests plus typecheck.

## Acceptance Criteria

- [x] `dv work record --worktree <path>` reads claims and configuration from the selected worktree.
- [x] Record and work-item evidence writes remain in that worktree.
- [x] The caller worktree receives no record file.
