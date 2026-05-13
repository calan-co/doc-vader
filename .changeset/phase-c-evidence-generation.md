---
"@calan-co/doc-vader": minor
---

feat(210-phase-c): Add evidence generation mode refinements

**Phase C: Evidence Generation Mode**

Improves backlog scan evidence generation with safer record behavior:

- Timestamp-based evidence record naming (`record-YYYYMMDD-HHMMSS-{work-item-id}.md`)
- Idempotency guard that reuses existing linked evidence records instead of creating duplicates
- Updated scan tests for timestamped evidence IDs and idempotent repeat runs
- Added evidence records reference documentation and fixed related scan CLI docs link
- Marked Phase C work item artifacts as ready-for-review

**Validation:** docs lint passes, backlog validate CI passes, backlog scan tests pass.
