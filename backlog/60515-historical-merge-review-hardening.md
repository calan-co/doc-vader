---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60515
title: Harden Historical Merge Review Findings
summary: Resolve verified review findings in the fail-closed historical merge reconciliation command.
type: work-item
subtype: task
lifecycle: active
status: running
status_reason: implementation
priority: high
estimated: 2
tags:
  - afk
  - runtime
  - review
---

## Goal

Resolve verified review findings without weakening historical merge verification.

## Tasks

- [x] Fix package policy discovery and malformed-policy failures.
- [x] Tighten PR, commit, rename, and configured-root validation.
- [x] Validate the review fixes.

## Acceptance Criteria

- [x] Packaged and source policy lookup is deterministic and fail-closed.
- [x] Evidence and commit attribution reject ambiguous references.
- [x] Renames and inconsistent configured roots are rejected.
