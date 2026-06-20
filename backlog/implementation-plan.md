---
title: Doc-Vader Entity Governance Roadmap
status: ready
id: roadmap-60361
type: document
subtype: generic
lifecycle: active
tags:
  - architecture
  - entity-governance
  - runtime
links:
  reference:
    - '[[../docs/how-to/implementation-plans/doc-vader-entity-governance-architecture-prd]]'
    - '[[../docs/architecture/decisions/adr-005-entity-governance-primitive-model]]'
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
---

## Roadmap Premise

Doc-Vader is now organized as an entity governance runtime. The current
implementation spine is the local runtime contract in
[[60361-git-sqlite-local-multi-agent-runtime-contract]], supported by the
architecture decisions in ADR-005 through ADR-008.

The previous implementation order was centered on earlier remark, schema,
Diataxis, and staging work. Those artifacts remain historical context, but they
are no longer the active roadmap for the next implementation phase.

## Priority Order

1. [ ] [[60372-supersede-single-agent-mvp-items]]
2. [ ] [[60363-runtime-entity-schemas]]
3. [ ] [[60362-runtime-sqlite-store-and-migrations]]
4. [ ] [[60375-lock-path-normalization-and-rename-gate]]
5. [ ] [[60364-atomic-claim-and-lock-acquisition]]
6. [ ] [[60377-work-item-governance-kernel]]
7. [ ] [[60373-claim-command-surface]]
8. [ ] [[60374-lock-command-surface]]
9. [ ] [[60366-authoritative-changed-file-lock-audit]]
10. [ ] [[60368-fail-closed-ready-list-show]]
11. [ ] [[60365-task-halt-command]]
12. [ ] [[60369-task-recover-command]]
13. [ ] [[60367-claim-prune-and-rm]]
14. [ ] [[60370-sandcastle-local-multi-agent-flow]]
15. [ ] [[60371-runtime-contract-integration-tests]]
16. [ ] [[60376-runtime-extension-authoring-process]]

## Reconciliation Notes

- Work Item is the canonical repository entity; Task is the command projection.
- The local runtime MVP uses Git plus SQLite as the runtime authority.
- Normalized repo-relative file locks replace scope-graph reservation semantics
  for the MVP.
- [[60339-agent-command-surface-for-skills-and-sandcastle]] remains useful as a
  parent command-surface contract, but implementation slices should follow
  [[60361-git-sqlite-local-multi-agent-runtime-contract]] and ADR-007.
- Paused scope-reservation items such as [[60342-task-scope-reservation-and-lookup]],
  [[60343-task-claim-store-and-lifecycle]],
  [[60344-claim-bound-artifact-reservations]], and
  [[60345-claim-aware-record-and-close-commands]] should be reconciled by
  [[60372-supersede-single-agent-mvp-items]] before they are resumed.

## Deferred Lanes

- Hosted SaaS and GitHub App architecture: [[60338-hosted-saas-github-app-architecture-adr]]
- Artifact graph and nested claims: [[60340-artifact-graph-and-nested-claim-architecture-adr]]
- Archive and pruned-index governance: [[60348-pruned-index-contract-and-historical-resolver-semantics]]
  through [[60353-archive-compatibility-cleanup-gate]]
- Prototype recovery: [[60359-project-registry-prototype-recovery]] and
  [[60360-link-policy-plugin-prototype-recovery]]

## Validation Standard

Roadmap changes must keep docs and backlog validation green:

- `pnpm run docs:lint`
- `pnpm run backlog:validate`
- `pnpm run backlog:validate:ci`
