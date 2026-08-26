---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60493
title: Publish Work Selection Transport
summary: Define the generic or pack-owned selection transport contract required before a publisher-owned Work selection adapter can be implemented.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 3
links:
  reference:
    - '[[../docs/reference/work-management/foundation.md]]'
tags:
  - work-management
  - document-type-packs
  - selection
  - transport
  - policy
---

## Goal

Establish the approved generic or pack-owned selection-transport seam required
before implementing a publisher-owned Work selection adapter.

## Background

Dependency review found no resolvable active Work Item dependency on the fresh
staging baseline. Historical selection and command-surface Work Items are absent
from that baseline and must not be copied as dependencies or as terminal,
evidence, or claim state.

The historical bridge proposed Work-specific unscoped `dv work capabilities` and
`dv work select` commands. That surface is incompatible with the approved
resource/id/subresource and pack-owned direction, so this item is design and
tracking only; it does not authorize that historical CLI implementation.

## Tasks

- [ ] Identify the generic or pack-owned owner and contract for selection transport before any publisher-owned Work adapter is implemented.
- [ ] Define how the transport carries Doc-Vader-owned selection outcomes without accepting consumer-supplied readiness semantics.
- [ ] Define fail-closed handling for malformed, unsupported, identity-mismatched, unavailable, denied, and non-selection outcomes.
- [ ] Make any standalone decoder or package-distribution choice explicit and reconcile it with supported Node `>=22` packaging.
- [ ] Record the approved contract owner and update this Work Item before authorizing an implementation tranche.

## Deliverables

- Approved generic or pack-owned selection-transport contract and owner.
- Selection outcome and failure-mode contract suitable for focused implementation tests.
- Explicit standalone-decoder and package-distribution decision, if one is needed.

## Acceptance Criteria

- [ ] The generic or pack-owned transport contract owner is identified before implementation begins.
- [ ] The eventual transport exposes no Work-specific unscoped CLI command, including `dv work capabilities` or `dv work select`.
- [ ] A Work adapter receives readiness only from Doc-Vader-owned evaluation; consumers cannot supply or redefine readiness semantics.
- [ ] Malformed, unsupported, identity-mismatched, unavailable, denied, and non-selection outcomes fail closed.
- [ ] Any standalone decoder or package-distribution decision is explicit and compatible with Node `>=22` support.
- [ ] This item does not implement resource-first CLI cutover, routing/schema runtime behavior, claim/runtime behavior, or historical terminal/evidence state.
