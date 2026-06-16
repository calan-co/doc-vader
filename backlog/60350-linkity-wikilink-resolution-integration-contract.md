---
id: wi-60350
title: Linkity Wikilink Resolution Integration Contract
summary: Define how Doc-Vader delegates custom wikilink and pruned-index resolution behavior to Linkity instead of growing a separate resolver model.
type: work-item
subtype: task
lifecycle: active
status: paused
status_reason: blocked
priority: medium
estimated: 3
links:
  depends_on:
    - '[[60348-pruned-index-contract-and-historical-resolver-semantics]]'
  evidence:
    - '[[record-20260616-043441-60350]]'
tags:
  - linkity
  - wikilinks
  - pruned-index
  - hitl
---

## Parent

[doc-vader Context Coordination PRD](../docs/how-to/implementation-plans/doc-vader-context-coordination-prd.md)

## What to build

Define the integration contract for Linkity-backed wikilink resolution before Doc-Vader adds pruned-index resolution behavior. The contract must describe which resolution responsibilities belong to Linkity, what adapter or API boundary Doc-Vader consumes, how pruned-index records are surfaced as historical references, and what diagnostics are emitted when links target pruned, active, archived, missing, or colliding records.

## Acceptance criteria

- [ ] The contract identifies Linkity as the owner of custom wikilink resolution behavior.
- [ ] Doc-Vader adapter responsibilities are limited to supplying work-management roots, pruned-index records, and lifecycle metadata.
- [ ] Diagnostics are specified for pruned historical records, missing targets, active/archive/pruned collisions, and unsupported references.
- [ ] The contract explains how pruned records remain discoverable without becoming active work items.
- [ ] The contract is sufficient for an AFK implementation slice to wire Doc-Vader to the Linkity-backed path.

## Blocked by

- [[60348-pruned-index-contract-and-historical-resolver-semantics]]
