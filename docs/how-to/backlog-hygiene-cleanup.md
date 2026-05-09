---
id: backlogh-8764
title: Run Backlog Hygiene Cleanup
type: document
subtype: generic
lifecycle: active
status: closed
---

## Goal

Run deterministic backlog hygiene cleanup with traceable artifacts and closure evidence.

## Steps

1. Run audit:
   - `pnpm run backlog:validate:ci`
   - Optional raw mode: `pnpm run backlog:validate:ci:raw`
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
   - Run strict gate: `pnpm run backlog:validate:ci`.

## Output Artifacts

- `backlog/audit/auditing-backlog-report.json`
- Updated archived work items in `backlog/archive/`
- Updated dashboard/index references.

## Execution Evidence

- 2026-03-02: `pnpm run backlog:validate:ci` passed with strict profile (`profiles/backlog-ci.json`).
- 2026-03-02: Report totals from `backlog/audit/auditing-backlog-report.json`:
  - `duplicate_ids=0`
  - `unresolved_wikilinks=0`
  - `parse_errors=0`
  - `no_inbound_active=0`
  - `schema_violations=0`
  - `exit_code=0`
