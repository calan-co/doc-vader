---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60517
title: Adopt Organization Reusable CI
summary: Add the organization CI hygiene caller while retaining doc-vader's existing package CI and release workflows.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: medium
completed_date: '2026-10-26'
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/120
  evidence:
    - '[[record-20261026-233054-60517]]'
tags:
  - ci
  - github-actions
---

## Goal

Adopt the organization reusable CI baseline without replacing doc-vader's
repository-specific CI and release workflows.

## Tasks

- [x] Add the organization hygiene workflow caller.
- [x] Preserve repository-specific CI and release workflows.

## Deliverables

- Organization CI workflow caller.
- Work Item linked to the implementation pull request.

## Acceptance Criteria

- [x] The pull request is linked by this Work Item.
- [x] Existing doc-vader CI remains unchanged.
- [x] The organization hygiene workflow runs on pull requests and staging pushes.

## Relationships

- `implements`: `[[../.github/workflows/organization-ci.yml]]`
