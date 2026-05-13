---
"@calan-co/doc-vader": patch
---

feat(210-phase-b): complete resolver condition and error taxonomy

Adds the remaining Phase B condition and error taxonomy to the backlog scan pipeline:

- `subject_resolved` condition reports whether the resolver chain found subjects for a work item
- `valid_evidence` condition validates that the evidence links block is present and populated
- `resolve_subject_failed` error captures resolver strategy failures
- `fetch_pr_metadata_failed` error captures linked-PR metadata fetch failures

Structured resolver failure reporting now propagates attempt-level errors to the scan report with strategy-typed codes, enabling downstream consumers to distinguish PR-metadata failures from generic resolution failures.

**Tests:** All scan, provider, and resolver tests pass. New assertions added for `subject_resolved` condition and taxonomy coverage.
