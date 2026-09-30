---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60506
title: Recover From Malformed Frontmatter During Work Listing
summary: Keep dv work list usable when an unrelated Markdown document has malformed YAML frontmatter.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 1
actual: 1
completed_date: '2026-09-29'
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/109
  evidence:
    - https://github.com/calan-co/doc-vader/commit/9437994861980b030af3ea22898837c7c427356d
    - '[[record-20260930-063851-60506]]'
tags:
  - work
  - yaml
  - regression
---

# Recover From Malformed Frontmatter During Work Listing

## Tasks

- [x] Reproduce the work-list failure caused by malformed frontmatter outside the backlog.
- [x] Add a regression test that keeps valid work items listable and reports the skipped file.
- [x] Skip malformed frontmatter during graph projection with a location-aware, content-safe warning.
- [x] Validate the focused test, typecheck, build, full test suite, and the original Vitae command.

## Acceptance Criteria

- [x] `dv work list` continues when an unrelated Markdown document has malformed YAML frontmatter.
- [x] The warning identifies the skipped relative path and YAML location without echoing document content.
- [x] Valid work items remain listed after malformed documents are skipped.
