---
id: wi-60405
title: Doc-Vader Semantic Graph Adapter Contract
summary: Define how Doc-Vader consumes Linkity, Semantify, and Context Graph outputs to evaluate link resolution and traversal policies.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: high
estimated: 5
links:
  depends_on:
    - '[[60391-projection-package-boundary-guard]]'
    - '[[60350-linkity-wikilink-resolution-integration-contract]]'
  reference:
    - '[[../docs/architecture/decisions/adr-005-entity-governance-primitive-model.md]]'
    - '[[../docs/architecture/decisions/adr-009-storage-and-format-seams.md]]'
    - '[[../docs/architecture/decisions/adr-010-composable-evaluation-primitives.md]]'
tags:
  - doc-vader
  - architecture
  - hitl
---

## Goal

Define the Doc-Vader adapter contract for consuming link occurrences, semantic
records, and context graph snapshots as governed subjects for link resolution
and traversal policy checks.

## Background

Doc-Vader should not own tokenization, semantic projection, or generic graph
indexing. It should own governance checks over graph subjects, including missing
targets, ambiguous targets, archived targets, pruned historical targets,
inactive targets, required backlink policies, invalid lifecycle traversal, and
related gate outcomes.

The related product and package decisions live in their owning repositories:

- `templjs/docs/adr/*semantic-graph-product-seams*` for Semantify and Context
  Graph product seams.
- `linkity/docs/explanation/adr-semantify-linkity-boundaries.md` for Linkity's
  Semantify-backed reference normalization and generation direction.

Doc-Vader references those decisions as external contracts. It does not host the
cross-product product strategy.

## Tasks

- [ ] Define adapter input shapes for Linkity link occurrences, Semantify
      semantic records, and Context Graph snapshots.
- [ ] Define Doc-Vader governed subjects produced from graph inputs.
- [ ] Define finding codes for link target and traversal policy outcomes.
- [ ] Specify provenance requirements for mapping findings back to source spans.
- [ ] Identify which existing Work graph projection behavior stays local until a
      package dependency pivot is justified.

## Deliverables

- Adapter contract note or ADR follow-up for semantic graph inputs.
- Finding code inventory for document graph traversal policies.
- Provenance requirements for graph-backed link findings.
- Migration notes for existing Linkity/pruned-index resolver work.

## Acceptance Criteria

- [ ] The contract keeps parser behavior outside Doc-Vader.
- [ ] The contract keeps semantic projection behavior outside Doc-Vader.
- [ ] The contract keeps graph indexing behavior outside Doc-Vader except for
      the current local projection port.
- [ ] Doc-Vader policy findings include stable subject identity, target
      identity, reason code, severity mapping inputs, and source provenance.
- [ ] The work references Doc-Vader governance ADRs and the external templjs and
      Linkity contract records by repository path.

## Relationships

- `depends_on`: `[[60391-projection-package-boundary-guard]]`
- `depends_on`: `[[60350-linkity-wikilink-resolution-integration-contract]]`
- `references`: `[[../docs/architecture/decisions/adr-005-entity-governance-primitive-model.md]]`
- `references`: `[[../docs/architecture/decisions/adr-009-storage-and-format-seams.md]]`
- `references`: `[[../docs/architecture/decisions/adr-010-composable-evaluation-primitives.md]]`
- External reference: `templjs/docs/adr/*semantic-graph-product-seams*`
- External reference: `linkity/docs/explanation/adr-semantify-linkity-boundaries.md`
