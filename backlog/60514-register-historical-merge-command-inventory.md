---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60514
title: Register Historical Merge Command Inventory
summary: Repair the Work command inventory parity regression for historical merge reconciliation.
type: work-item
subtype: task
lifecycle: active
status: running
status_reason: implementation
priority: high
estimated: 1
tags:
  - afk
  - runtime
  - regression
---

## Goal

Keep the published Work command inventory aligned with the historical merge reconciliation CLI command.

## Tasks

- [x] Add the missing command inventory entry.
- [x] Run the parity test and CI-relevant validation.

## Acceptance Criteria

- [x] `dv work --help` and the immutable inventory list the same commands.
- [x] The Node 22 and Node 24 command parity validation passes.
