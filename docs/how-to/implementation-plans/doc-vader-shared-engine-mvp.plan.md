# Doc-Vader Shared-Engine MVP Plan (Revised with Backlog Hygiene Cleanup)

## Summary

This plan keeps `doc-vader` as the shared validation engine and adds a dedicated backlog hygiene action lane that executes your requested flow:

1. run `auditing-backlog`
2. address findings
3. run `update-work-item` to close unused/irrelevant items with `status_reason`
4. run `finalize-work-item` for all `closed` items
5. reconcile remaining items to schema for low-friction forward consistency

Primary repo is `doc-vader`, with explicit consumer migration tasks for `templjs` and `pax`, over a 4-6 week horizon.

## Milestone Progress (Traceability)

| Milestone | Status | Evidence |
| --- | --- | --- |
| M1: Baseline + schema alignment (`208.2.*`) | complete | [`schemas/frontmatter/work-item/1.0.0.json`](/Users/macos/dev/tiab/doc-vader/schemas/frontmatter/work-item/1.0.0.json), [`schemas/frontmatter/document/1.0.0.json`](/Users/macos/dev/tiab/doc-vader/schemas/frontmatter/document/1.0.0.json) |
| M2: Backlog audit + remediation (`208.1.*`) | complete | [`backlog/audit/auditing-backlog-report.json`](/Users/macos/dev/tiab/doc-vader/backlog/audit/auditing-backlog-report.json) |
| M3: Controlled closure + finalization (`208.3.*`) | complete | [`backlog/archive/160.template-compliance-feature.md`](/Users/macos/dev/tiab/doc-vader/backlog/archive/160.template-compliance-feature.md), [`backlog/archive/30.markdown-linting-commercialization.md`](/Users/macos/dev/tiab/doc-vader/backlog/archive/30.markdown-linting-commercialization.md), [`backlog/archive/174.1.graph-and-naming-story 1.md`](/Users/macos/dev/tiab/doc-vader/backlog/archive/174.1.graph-and-naming-story%201.md), [`backlog/archive/188.spike-core-linting-framework-scope-definition-story.md`](/Users/macos/dev/tiab/doc-vader/backlog/archive/188.spike-core-linting-framework-scope-definition-story.md) |
| M4: Reconciliation + strict gating (`208.4.*`) | complete | `npm run backlog:validate:ci`, [`staging/scripts/backlog-hygiene-ci.sh`](/Users/macos/dev/tiab/doc-vader/staging/scripts/backlog-hygiene-ci.sh), [`backlog/audit/auditing-backlog-report.json`](/Users/macos/dev/tiab/doc-vader/backlog/audit/auditing-backlog-report.json), [`backlog/208.4.2.hygiene-ci-gate-task.md`](/Users/macos/dev/tiab/doc-vader/backlog/208.4.2.hygiene-ci-gate-task.md) |
| M5: Shared-engine consumer stabilization (`207.*`) | in-progress | [`backlog/207.shared-engine-mvp-epic.md`](/Users/macos/dev/tiab/doc-vader/backlog/207.shared-engine-mvp-epic.md), pending templjs/pax consumer integration tasks |

## Execution Log

- 2026-02-27: Implemented backlog hygiene cleanup lane and archived validated closure candidates (`160`, `174.1` duplicate, `188` spike, `30`).
- 2026-02-27: Added schema compatibility updates for closure model and legacy backlog conformance.
- 2026-02-27: Implemented `doc-vader backlog validate` with `--fail-on`, `--format json`, `--profile`, and `--schema-map`.
- 2026-02-27: Regenerated audit artifact using new engine at `backlog/audit/auditing-backlog-report.json`.
- 2026-02-27: Verified test and gate behavior (`npm run build`, `vitest run tests/backlog-audit.test.ts`, error-mode pass, warning-mode fail).
- 2026-02-27: Added CI hygiene gate script (`staging/scripts/backlog-hygiene-ci.sh`) and routed `npm run backlog:validate:ci` to emit JSON artifact deterministically.
- 2026-02-27: Latest strict CI gate run returned `exit 1` with `no_inbound_active=21` and refreshed artifact timestamp (`backlog/audit/auditing-backlog-report.json`).

## Scope

1. In scope: `doc-vader` backlog/schema/docs/process hardening, strict gating, consumer integration tasks.
2. In scope: introducing `status_reason` and `closed` closure workflow compatibility in `doc-vader`.
3. In scope: archival/finalization workflow for closed work items.
4. Out of scope: full ID model migration to `templjs` conventions in this MVP.

## Required Public Interface and Schema Changes

1. Add `status_reason` to work-item frontmatter schema in [work-item schema](/Users/macos/dev/tiab/doc-vader/schemas/frontmatter/work-item/1.0.0.json) and alias in `current.json`.
2. Add closure-compatible status handling in [document schema](/Users/macos/dev/tiab/doc-vader/schemas/frontmatter/document/1.0.0.json):
   - Add `closed` to status enum.
   - Preserve legacy statuses for backward compatibility.
   - Add lifecycle/status compatibility for `closed`.
3. Add closure reason enum:
   - `success`, `obsolete`, `redundant`, `superseded`, `cancelled`.
4. Add CLI gate controls:
   - `--fail-on error|warning`.
   - `--profile <name|path>`.
5. Add machine-readable output mode:
   - `--format json` for lint/audit reports.
6. Add optional schema-map routing support compatible with `templjs` `schema-map.json` style.

## Backlog Updates (Existing Items)

1. Update [170.remark-lint-unified-adoption-epic.md](/Users/macos/dev/tiab/doc-vader/backlog/170.remark-lint-unified-adoption-epic.md) to include shared-engine + hygiene lane completion criteria.
2. Update [support-multi-frameworks.md](/Users/macos/dev/tiab/doc-vader/backlog/support-multi-frameworks.md) to include profile-driven governance and reconciliation.
3. Update [framework-reconciliation.md](/Users/macos/dev/tiab/doc-vader/backlog/framework-reconciliation.md) for deterministic non-interactive strategy selection.
4. Update [171.2.4.task-update-docs-lint-sh-to-use-remark-lint-pipeline.md](/Users/macos/dev/tiab/doc-vader/backlog/171.2.4.task-update-docs-lint-sh-to-use-remark-lint-pipeline.md) to include strict fail policy and JSON output acceptance criteria.
5. Update [172.frontmatter-schema-integration-feature.md](/Users/macos/dev/tiab/doc-vader/backlog/172.frontmatter-schema-integration-feature.md) to include status_reason/closed migration and schema-map routing.

## New Work Items (Discrete, Actionable)

1. `207.shared-engine-mvp-epic` (epic): Shared engine + strict validation + consumer pilots.
2. `208.backlog-hygiene-cleanup-epic` (epic): End-to-end hygiene cleanup and archival.
3. `208.1.audit-backlog-story` (story): Run `auditing-backlog`, produce findings report with categories and risk tags.
4. `208.1.1.run-auditing-backlog-task` (task): Execute audit workflow and capture artifact report.
5. `208.1.2.address-audit-findings-task` (task): Resolve dependency/orphan/consistency findings directly.
6. `208.2.closure-model-alignment-story` (story): Add `closed` + `status_reason` schema support and docs.
7. `208.2.1.schema-status-reason-task` (task): Implement schema updates + compatibility rules.
8. `208.2.2.update-work-item-closure-task` (task): Define/implement closure transition rules for `update-work-item`.
9. `208.3.cleanup-unused-items-story` (story): Close only validated unused/irrelevant items.
10. `208.3.1.close-unused-items-task` (task): Apply `update-work-item` to set `status: closed` + applicable `status_reason`.
11. `208.3.2.finalize-closed-items-task` (task): Run `finalize-work-item` for all closed items and archive.
12. `208.4.schema-reconciliation-story` (story): Reconcile remaining active items with schema and templates.
13. `208.4.1.reconcile-active-items-task` (task): Normalize frontmatter/status fields for all non-archived items.
14. `208.4.2.hygiene-ci-gate-task` (task): Add CI gate enforcing backlog hygiene checks.

## Epic Decomposition (Plan -> Backlog)

This implementation plan decomposes into the following epic work items, with scope boundaries aligned to the MVP phases and lanes:

1. `170.remark-lint-unified-adoption-epic` (epic)
   - Scope: shared linting architecture and trunk integration baseline.
2. `208.backlog-hygiene-cleanup-epic` (epic)
   - Scope: weeks 1-4 backlog hygiene lane (audit/remediation/closure/reconciliation + strict gating).
3. `207.shared-engine-mvp-epic` (epic)
   - Scope: weeks 5-6 consumer stabilization for `templjs` and `pax`.

In-scope trunk work items for MVP dependency wiring:

- `170.remark-lint-unified-adoption-epic`
- `171.2.4.task-update-docs-lint-sh-to-use-remark-lint-pipeline`
- `172.frontmatter-schema-integration-feature`
- `support-multi-frameworks`
- `framework-reconciliation`

Each corresponding epic includes `depends_on` links for this in-scope trunk set (excluding self-reference where applicable).

## Backlog Hygiene Cleanup Action Lane (Exact Execution Flow)

1. Run `auditing-backlog`.
2. Address findings in-place before any closure action.
3. Determine closure candidates using deterministic criteria:
   - No inbound dependency references from active items.
   - Not a dependency of in-progress/accepted work.
   - Not part of current MVP critical path.
   - Explicitly tagged as duplicate/redundant/obsolete/cancelled by evidence.
4. For confirmed candidates, run `update-work-item`:
   - Set `status: closed`.
   - Set `status_reason` from approved enum.
   - Add timestamped note with evidence and replacement link if applicable.
5. Run `finalize-work-item` for all `closed` items:
   - Verify closure metadata complete.
   - Move items to archive path.
   - Update cross-links/indexes/backlog dashboard references.
6. Reconcile all remaining non-archived items against work-item schemas:
   - Normalize required fields, status/lifecycle compatibility, dependency references.
   - Ensure no schema violations and no broken links.

## MVP Delivery Phases (4-6 Weeks)

1. Week 1: Baseline and schema alignment.
   - Complete `208.2.*`.
   - Update docs for closure model and hygiene policy.
2. Week 2: Audit and remediation.
   - Complete `208.1.*`.
   - Produce audit artifacts and remediation commit sets.
3. Week 3: Controlled closure and finalization.
   - Complete `208.3.*`.
   - Archive closed items and refresh dashboards/navigation.
4. Week 4: Reconciliation and strict gating.
   - Complete `208.4.*`.
   - Enforce CI gate with fail policy.
5. Week 5-6: Shared-engine integration stabilization.
   - Complete `207.*` consumer tasks for `templjs` and `pax`.
   - Validate parity and remove cross-repo script coupling.

## Test Cases and Validation Scenarios

1. Schema migration tests:
   - `status: closed` valid for work-item.
   - `status_reason` required when `status=closed`.
2. Transition tests:
   - Invalid transitions rejected.
   - Closed transitions require dependency closure and evidence.
3. Audit tests:
   - Orphan detection flags true candidates.
   - False positives excluded by deterministic criteria.
4. Finalization tests:
   - Closed items move to archive.
   - Links/indexes/dashboard updated and valid.
5. Reconciliation tests:
   - All remaining backlog items pass frontmatter schema.
   - No broken dependency wikilinks.
6. CI gate tests:
   - Fails on unresolved hygiene violations.
   - Passes on clean backlog.
7. Consumer integration tests:
   - `templjs` pilot path validates against shared contract.
   - `pax` no longer depends on `../templjs/scripts/ci/*` for backlog validation behavior.

## Documentation Deliverables

1. Update [project-brief.md](/Users/macos/dev/tiab/doc-vader/docs/project-brief.md) with shared-engine + hygiene lane objectives.
2. Update [remark-lint-unified-architecture.md](/Users/macos/dev/tiab/doc-vader/docs/reference/remark-lint-unified-architecture.md) with closure and guardrail layers.
3. Add `docs/how-to/backlog-hygiene-cleanup.md` documenting the 1-4 action flow.
4. Add `docs/how-to/closure-reason-policy.md` defining `status_reason` usage.
5. Update [CONTRIBUTING.md](/Users/macos/dev/tiab/doc-vader/CONTRIBUTING.md) with mandatory hygiene gate checks.

## Assumptions and Defaults

1. `doc-vader` is the source-of-truth engine; `templjs` and `pax` are consumers.
2. `status_reason` and `closed` are added to `doc-vader` schema for workflow compatibility.
3. Legacy statuses remain readable during MVP but new closure actions use `closed + status_reason`.
4. Closure of backlog items is evidence-driven and reversible only via explicit reopen task.
5. Reliability-first rubric is enforced: schema correctness and deterministic CI behavior take priority over speed.
