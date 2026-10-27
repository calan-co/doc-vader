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
links:
  evidence:
    - '[[record-20261026-164842-60515]]'
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
- [x] Reject null policies and preserve exact Git path identity.
- [x] Raise the slow public CLI integration test timeout for Windows Node 22.

## Acceptance Criteria

- [x] Packaged and source policy lookup is deterministic and fail-closed.
- [x] Evidence and commit attribution reject ambiguous references.
- [x] Renames and inconsistent configured roots are rejected.
- [x] Null policies fail with the reconciliation policy error, and changed-file paths are not rewritten.
- [x] The Windows Node 22 public CLI integration test has a scoped 30-second timeout.
- [x] A verified reconciliation may exempt only its active claim's immutable historical paths during success release.
