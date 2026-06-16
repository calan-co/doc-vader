---
id: wi-60351
title: Pruned Index Link Resolution Support
summary: Wire pruned-index records into the Linkity-backed resolver path as historical references without making them active work items.
type: work-item
subtype: story
lifecycle: active
status: paused
status_reason: blocked
priority: medium
estimated: 5
links:
  depends_on:
    - '[[60349-atomic-archive-pruning-command]]'
    - '[[60350-linkity-wikilink-resolution-integration-contract]]'
tags:
  - linkity
  - wikilinks
  - pruned-index
  - afk
---

## Parent

[doc-vader Context Coordination PRD](../docs/how-to/implementation-plans/doc-vader-context-coordination-prd.md)

## What to build

Make pruned-index records discoverable through the Linkity-backed resolver and link-index path. Historical pruned records must resolve for audit and backlink discovery, but must not appear as active work items, ready-selection candidates, or duplicated successor/reference metadata in the pruned index.

## Acceptance criteria

- [ ] Pruned-index records are exposed to the Linkity-backed resolver through the agreed integration boundary.
- [ ] Links to pruned records resolve as historical references with deterministic diagnostics.
- [ ] Pruned records are hidden from active backlog queries and ready selection.
- [ ] Successor and reference links remain owned by successor artifacts and discoverable through link indexing/backlinks.
- [ ] Collision cases between live, archived, and pruned records follow the approved contract.
- [ ] Tests cover pruned historical resolution, missing pruned records, collision diagnostics, and exclusion from active work selection.

## Blocked by

- [[60349-atomic-archive-pruning-command]]
- [[60350-linkity-wikilink-resolution-integration-contract]]
