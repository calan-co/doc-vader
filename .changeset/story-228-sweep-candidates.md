---
"@calan-co/doc-vader": minor
---

feat(228): sweep validate and archive candidates

Story 228 implements end-to-end candidate validation and archival orchestration:

- Extended `BacklogScanOptions` and `BacklogScanReport` with candidate validation fields
- Added `ConsumerAutomation` config options for `validateArchiveCandidates` and `invalidCandidateStatus`
- Implemented candidate discovery, validation, and archival flow in scan executor
- Created `work-item-validation` utilities with archive readiness and closure evidence checks
- Added remark-lint rules for archive prerequisites and closed-item metadata validation
- Extended scan reporter to display candidate validation metrics
- Updated scan-report JSON schema with candidate validation properties
- Enabled feature in backlog-sweep workflow
- Added 3 comprehensive integration tests covering normal flow, discrepancy handling, and CLI overrides
- All 30 backlog scan tests passing
