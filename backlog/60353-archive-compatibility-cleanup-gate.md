---
id: wi-60353
title: Archive Compatibility Cleanup Gate
summary: Add compatibility gates proving active work items use canonical statuses while archived and pruned historical records remain resolvable.
type: work-item
subtype: story
lifecycle: active
status: paused
status_reason: blocked
priority: medium
estimated: 5
links:
  depends_on:
    - '[[60347-configured-archive-validation-cli-slice]]'
    - '[[60351-pruned-index-link-resolution-support]]'
tags:
  - archive
  - compatibility
  - validation
  - afk
---

## Parent

[doc-vader Context Coordination PRD](../docs/how-to/implementation-plans/doc-vader-context-coordination-prd.md)

## What to build

Add tests and validation gates that prove active backlog/work-item lifecycle states use canonical current statuses while archived and pruned historical records remain resolvable. Use the results to identify legacy compatibility code that can be removed safely after pruned-index resolver support is complete.

## Acceptance criteria

- [ ] Active non-archived work items are validated against canonical current lifecycle/status expectations.
- [ ] Archived files remain valid through declared schema or configured fallback schema behavior.
- [ ] Pruned-index records remain historically resolvable through the Linkity-backed path.
- [ ] Ready selection and active backlog queries exclude archived and pruned historical records.
- [ ] The gate identifies legacy compatibility code that is safe to remove, or records why removal must be deferred.
- [ ] Tests cover active, archived, and pruned historical records together.

## Blocked by

- [[60347-configured-archive-validation-cli-slice]]
- [[60351-pruned-index-link-resolution-support]]
