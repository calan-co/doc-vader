---
id: wi-60330
title: Unified Remark Validation Pipeline
summary: Deliver schema-backed remark validation, Diataxis/template rules, cross-file registry rules, policy suggestions, and executable processor tests as one end-to-end validation pipeline.
type: work-item
subtype: story
lifecycle: active
status: in-progress
status_reason: investigation
priority: high
estimated: 8
commits:
  ebc011c73c333729b7ea4ae7ba95810c3f1272a0: 'chore(backlog): consolidate active work item backlog'
links:
  pull_requests:
    - 'https://github.com/calan-co/doc-vader/pull/60'
  evidence:
    - '[[record-20260612-backlog-consolidation]]'
  reference:
    - '[[archive/170.remark-lint-unified-adoption-epic]]'
    - '[[archive/172.1.unify-frontmatter-validation-story]]'
    - '[[archive/172.2.schema-error-position-mapping-task]]'
    - '[[archive/172.frontmatter-schema-integration-feature]]'
    - '[[archive/173.1.diataxis-template-story]]'
    - '[[archive/173.diataxis-and-template-integration-feature]]'
    - '[[archive/174.1.graph-and-naming-story]]'
    - '[[archive/174.cross-file-graph-and-naming-feature]]'
    - '[[archive/175.1.1.link-policy-plugin-task]]'
    - '[[archive/175.1.policies-and-suggestions-story]]'
    - '[[archive/175.extended-rules-and-autofix-feature]]'
    - '[[archive/209-execution_item_ownership_lint]]'
    - '[[archive/229.unified-remark-processor-test-suite-story]]'
    - '[[archive/231.diataxis-template-compliance-checklist-task]]'
tags:
  - unified
  - remark
  - validation
  - afk
---

## Goal

Deliver one cohesive validation pipeline that runs frontmatter schema checks, Diataxis/template checks, cross-file graph checks, naming/backlog semantics, ownership checks, and policy suggestions through the unified remark processor with executable tests and documentation.

## User Stories

1. As a maintainer, I want one validation entrypoint to run schema, content, link, naming, and policy checks, so that quality gates do not drift across scripts.
2. As a contributor, I want validation failures to point to actionable locations and rules, so that I can fix documents without reading implementation code.
3. As an automation agent, I want processor composition and baseline behavior covered by tests, so that AFK changes can be merged with confidence.

## What To Build

Implement the unified remark processor path end to end: schema validation, YAML position metadata, Diataxis placement and template compliance, project registry backed cross-reference and naming checks, dependency/policy suggestions, execution-item ownership validation, and processor test baselines.

## Acceptance Criteria

- [ ] Frontmatter schema validation runs inside the unified remark pipeline with stable human and JSON diagnostics.
- [ ] Diataxis placement and template compliance are enforced by reusable remark rules and documented checklist fixtures.
- [ ] Cross-file references, naming rules, backlog semantics, and execution ownership use a shared registry or equivalent stable project graph.
- [ ] Link policy, dependency-cycle detection, and safe non-mutating suggestions are available in validation output.
- [ ] Processor composition, CLI integration, representative fixtures, and baseline performance are covered by tests.

## Blocked By

None - can start immediately.

## Supersedes

- [[archive/170.remark-lint-unified-adoption-epic]]
- [[archive/172.1.unify-frontmatter-validation-story]]
- [[archive/172.2.schema-error-position-mapping-task]]
- [[archive/172.frontmatter-schema-integration-feature]]
- [[archive/173.1.diataxis-template-story]]
- [[archive/173.diataxis-and-template-integration-feature]]
- [[archive/174.1.graph-and-naming-story]]
- [[archive/174.cross-file-graph-and-naming-feature]]
- [[archive/175.1.1.link-policy-plugin-task]]
- [[archive/175.1.policies-and-suggestions-story]]
- [[archive/175.extended-rules-and-autofix-feature]]
- [[archive/209-execution_item_ownership_lint]]
- [[archive/229.unified-remark-processor-test-suite-story]]
- [[archive/231.diataxis-template-compliance-checklist-task]]
