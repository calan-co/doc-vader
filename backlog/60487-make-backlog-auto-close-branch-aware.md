---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60487
title: Make Backlog Auto-Close Branch-Aware
summary: Prevent staging merges from terminalizing Work Items while preserving PR-link and workflow-evidence ingestion.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 3
links:
  depends_on:
    - '[[60488-add-provider-neutral-delivery-facts]]'
  reference:
    - '[[../docs/reference/work-management/foundation]]'
tags:
  - backlog-automation
  - delivery
  - lifecycle
---

## Goal

Ensure backlog automation distinguishes staging integration from verified main delivery so a staging merge cannot terminalize a Work Item.

## Background

Current merge ingestion can finalize a linked Work Item without distinguishing
the integration branch. Staging must retain delivery evidence without asserting
that main delivery has occurred.

## Tasks

- [ ] Identify and test the current auto-close path for merged Work-Item-linked pull requests.
- [ ] Make auto-close branch-aware while preserving staging PR-link and workflow-evidence ingestion.
- [ ] Preserve existing lifecycle, evidence, and terminal-metadata validation before any terminal update.

## Deliverables

- Branch-aware auto-close configuration and implementation.
- Regression coverage for staging and main merge behavior.

## Acceptance Criteria

- [ ] A staging merge records its PR link and workflow evidence without terminalizing the linked Work Item.
- [ ] A main merge may auto-finalize only after existing evidence, lifecycle, and terminal-metadata gates pass.
- [ ] Existing PR-link and workflow-evidence ingestion behavior remains covered by regression tests.
