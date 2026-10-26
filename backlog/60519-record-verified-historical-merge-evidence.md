---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60519
title: Record Verified Historical Merge Evidence
summary: Permit CI and review evidence for a verified historical merge without claiming its already-published files.
type: work-item
subtype: bug
lifecycle: active
status: running
status_reason: implementation
priority: critical
estimated: 1
links:
  reference:
    - '[[60518-preserve-runtime-state-during-recovery]]'
    - https://github.com/calan-co/doc-vader/pull/118
tags:
  - afk
  - runtime
  - records
  - historical-merge
---

## Goal

Allow an active current claim to record CI or review evidence for exactly one
already-published historical merge after verifying the linked PR, immutable
commit, published ref, and complete changed-file manifest.

## Acceptance Criteria

- [ ] Historical evidence mode excludes only the verified historical manifest from the current lock audit.
- [ ] Historical CI/review records bind the work item, PR URL, resolved commit, published ref, and manifest.
- [ ] Ordinary record behavior and active-claim checks remain fail closed.
- [ ] Foreign PRs, commits, evidence, and manifest paths are rejected.
