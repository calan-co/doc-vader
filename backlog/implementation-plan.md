---
title: Doc-Vader Implementation Plan & Subagent Instructions
date: 2025-11-18
status: active
ordinal: 1000
---

## Implementation Order

See below for the prioritized list:

1. [x] [[156.lint-frontmatter-bug.md]]
2. [x] [[171.remark-config-and-core-pipeline-feature]]
3. [ ] [[172.frontmatter-schema-integration-feature.md]]
4. [x] `160.template-compliance-feature` (closed/superseded; archived)
5. [ ] [[173.diataxis-and-template-integration-feature.md]]
6. [ ] [[174.cross-file-graph-and-naming-feature.md]]
7. [ ] [[176.ci-integration-and-deprecation-feature.md]]
8. [ ] [[170.remark-lint-unified-adoption-epic.md]]
9. [ ] [[181.audit-staging-scripts-feature.md]]
10. [ ] [[180.staging-script-consolidation-epic.md]]
11. [ ] [[182.migrate-core-scripts-to-typescript-feature.md]]
12. [ ] [[183.deprecate-obsolete-staging-scripts-feature.md]]
13. [ ] [[task-precedence-tests.md]]
14. [ ] [[175.extended-rules-and-autofix-feature.md]]
15. [ ] [[task-frontmatter-fixer.md]]

## Progress: 171.unified-config-and-core-pipeline-feature

- [x] `.remarkrc.mts` created with ESM and plugin layers
- [x] `createTiabProcessor()` implemented in TypeScript/ESM
- [x] Plugins refactored to use zod schemas for options
- [x] Unit tests written for checklist, crossref, and template compliance plugins
- [ ] Integration test for processor and config
- [ ] Documentation update for config and usage

### Decisions & Notes

- All code is ESM and TypeScript.
- Zod is used for option validation in all plugins.
- Blocker: `171.1.2.plugin-normalization-and-tests-task.md` is missing, but plugin normalization was completed based on available requirements.
- Next: Add integration test for processor and update documentation.

---

## Subagent Instructions

- For each file in the order above:

  1. Read and summarize requirements, dependencies, and deliverables.
  2. Define clear acceptance criteria and completion checklist.
  3. Plan implementation steps and assign to appropriate subagent (QA, Change Manager, Documentation, Engineering, DevOps).
  4. Track progress and update status after each session.
  5. Report blockers and adjust plan as needed.

- Use markdown checklists for tracking within each file or a central dashboard.
- Review and reprioritize weekly or as new information emerges.

## Session Guidance

- Start with the first file in the list and proceed sequentially unless reprioritization is required.
- Document all decisions, changes, and completion status in this file or a linked dashboard.
- Assign subagents based on task type and expertise.
- Ensure all deliverables and acceptance criteria are met before marking a task complete.
