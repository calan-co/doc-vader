---
$schema: schemas/work-management/frontmatter/plan.json
title: Release Candidate Implementation Plan
summary: Operational plan covering RC-scope implementation sequencing, parallel workstreams, and validation gates.
id: 'plan:rc-release-candidate-implementation'
owner: change-manager
type: plan
subtype: operational
lifecycle: active
status: ready
tags:
  - release
  - plan
  - rc
---

## Scope

This plan covers the current release-candidate scope for doc-vader:

- Epic 170 in full
- Epic 180 in full
- Epic 210 in full
- WI-52469 in RC scope
- WI-225, WI-226, and WI-227
- New decomposition items WI-228 through WI-236

WI-60275 remains deferred, but RC must still deliver the minimum deterministic reconciliation core required by WI-52469.

## Sequencing

1. Complete Epic 210 to stabilize schema and configuration foundations
2. Complete Epic 170 Phase 1 with WI-228 and WI-229 as exit-gate support
3. Complete the remaining Epic 170 tracks and phases, including extended rules and CI integration
4. Deliver WI-52469 through WI-235 and WI-236 before narrowing WI-60275 to post-RC workflow expansion
5. Execute Epic 180 after Epic 170 Phase 1 clarifies subsumed versus migratable staging scripts
6. Complete lifecycle and automation items in parallel where they do not block the core path
7. Apply WI-233 as the final RC gate before branch cut

## Parallel Workstreams

- Epic 210 Phase 2A and Phase 2B
- Epic 170 Track A, Track B, and Track C after Phase 1
- WI-52469 late-core implementation alongside late Epic 170 work
- Epic 180 migration branch and utility branch after audit completion
- WI-225, WI-226, and WI-227 with WI-234 support

## Decomposition Items

- [[228.design-cross-file-registry-model-story.md]]
- [[229.unified-remark-processor-test-suite-story.md]]
- [[230.define-epic-180-audit-scope-task.md]]
- [[231.diataxis-template-compliance-checklist-task.md]]
- [[232.post-rc-reconciliation-adr-task.md]]
- [[233.release-candidate-readiness-criteria-task.md]]
- [[234.github-app-deployment-and-ci-plan-story.md]]
- [[235.multi-profile-schema-routing-task.md]]
- [[236.deterministic-reconciliation-core-task.md]]

## Required Validation

After each workstream merge:

1. Run `pnpm run backlog:validate`
2. Run the narrowest relevant tests for the changed slice
3. Rerun `pnpm run docs:lint` when documentation or backlog files change

Before RC branch cut:

1. Run `pnpm run backlog:validate:ci`
2. Run the targeted tests required by the completed RC slices
3. Update release notes and changelog
4. Produce a clean backlog audit artifact
