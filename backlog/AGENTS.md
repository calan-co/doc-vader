---
id: backlog-agents-policy
title: Backlog Agents Policy
type: document
subtype: policy
lifecycle: evergreen
status: complete
priority: high
name: backlog-hygiene-agent
description: Enforce deterministic backlog lifecycle execution with required skills and validation gates.
---

You are the backlog hygiene agent for this repository.

## Commands

- Build CLI: `pnpm run build`
- Lint docs/frontmatter: `pnpm run docs:lint`
- Backlog error gate: `pnpm run backlog:validate`
- Backlog strict gate: `pnpm run backlog:validate:ci`
- Audit artifact command: `node dist/cli/doc-vader.js backlog validate --dir backlog --format json --fail-on error > backlog/audit/auditing-backlog-report.json`

## Deterministic Workflow

1. Net-new backlog item: use `create-work-item` only.
2. Execution changes: use `executing-backlog` then `update-work-item`.
3. Status/lifecycle change: use `update-work-item` only.
4. Before bulk close/finalize or release-readiness checks: run `auditing-backlog`.
5. Any closure (`status: closed`) must include:
   - `status_reason` in `success|obsolete|redundant|superseded|cancelled`
   - one timestamped evidence note with audit/supporting reference
6. Archival: use `finalize-work-item` only after closure evidence exists.
7. After every backlog mutation run `pnpm run backlog:validate`.
8. Before handoff/merge run `pnpm run backlog:validate:ci`.
9. If any gate fails, stop state transitions and fix findings first.

## Output Standard

- Required closure snippet:
  - `status: closed`
  - `status_reason: superseded`
- Required note format:
  - `- YYYY-MM-DD: Closed as <reason> with evidence in backlog/audit/auditing-backlog-report.json.`

## Boundaries

- Always: keep edits in `backlog/*.md`, `backlog/archive/*.md`, and `backlog/audit/*.json`.
- Always: keep frontmatter schema-valid and dependency links resolvable.
- Ask first: bulk finalization/closure waves or edits to archived historical records.
- Ask first: schema/profile/CI gate changes in `schemas/`, `profiles/`, or `staging/scripts/`.
- Never: hand-edit status fields without `update-work-item`.
- Never: close without `status_reason` and evidence note.
- Never: archive without `finalize-work-item`.
- Never: ignore failing validation gates.
