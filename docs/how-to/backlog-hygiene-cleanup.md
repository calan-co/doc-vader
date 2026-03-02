---
id: backlog-hygiene-cleanup
title: Run Backlog Hygiene Cleanup
type: document
subtype: how-to
lifecycle: active
status: proposed
---

## Goal

Run deterministic backlog hygiene cleanup with traceable artifacts and closure evidence.

## Steps

1. Run audit:
   - `doc-vader backlog validate --dir backlog --format json --fail-on error > backlog/audit/auditing-backlog-report.json`
2. Address findings before closure actions:
   - Resolve duplicates, broken links, and schema violations.
3. Close validated irrelevant items:
   - Set `status: closed`
   - Set `status_reason` (`success|obsolete|redundant|superseded|cancelled`)
   - Add timestamped evidence note.
4. Finalize closed items:
   - Move to `backlog/archive/`
   - Update dashboard/index/cross-links.
5. Reconcile remaining active items:
   - Ensure active backlog files pass schema validation.
   - Run strict gate: `npm run backlog:validate:ci`.

## Output Artifacts

- `backlog/audit/auditing-backlog-report.json`
- Updated archived work items in `backlog/archive/`
- Updated dashboard/index references.
