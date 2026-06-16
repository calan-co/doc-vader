---
id: wi-60348
title: Pruned Index Contract and Historical Resolver Semantics
summary: Decide the pruned-index schema, historical identity fields, lifecycle classification, and collision behavior before archive pruning writes durable records.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: high
estimated: 3
links:
  reference:
    - '[[60347-configured-archive-validation-cli-slice]]'
  evidence:
    - '[[record-20260616-043441-60348]]'
tags:
  - archive
  - pruning
  - pruned-index
  - hitl
---

## Parent

[doc-vader Context Coordination PRD](../docs/how-to/implementation-plans/doc-vader-context-coordination-prd.md)

## What to build

Produce the decision record or equivalent contract for the pruned index before implementation depends on it. The contract must settle the pruned-index path, schema id, JSON shape, append-only versus future compaction policy, required historical fields such as `last_seen_commit`, resolver lifecycle classification, collision behavior when a live file and pruned record share identity, and historical visibility rules.

## Acceptance criteria

- [ ] The pruned-index path, schema id, and JSON shape are documented.
- [ ] Required record fields include enough identity to find the historical archived Markdown in git, including `last_seen_commit`.
- [ ] Append-only behavior and any future compaction policy are explicitly decided.
- [ ] Resolver classification is explicit, including whether pruned records are historical-only, non-active, hidden from ready selection, or another lifecycle category.
- [ ] Collision behavior is specified for live files, archive files, and pruned-index records that share id or historical path.
- [ ] The decision is sufficient for AFK implementation of archive pruning and resolver integration.

## Blocked by

None - can start immediately.
