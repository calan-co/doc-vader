---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60473
title: Publish Versioned Work-result Selection Contract
summary: Publish the authoritative versioned Work-result contract and official consumer selection decoder for downstream orchestrators.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 2
links:
  reference:
    - "[[../docs/reference/work-management/foundation.md]]"
tags:
  - work
  - contracts
  - consumers
  - versioning
---

# Publish Versioned Work-result Selection Contract

## Goal

Publish a stable, versioned Doc-Vader Work-result selection contract and
consumer decoder so downstream systems consume one publisher-owned semantic
boundary rather than duplicate schemas.

## Background

`dv work ready --json` emits `task-ready/v1` with `candidates`. Babysitter-DV
has a legacy copied `v1/workItems` decoder and therefore rejects a valid result.
Doc-Vader owns Work-result schema and readiness semantics; consumers must use
an explicit official selection port and fail closed before effects on invalid or
unsupported results.

## Tasks

- [ ] Define and publish the versioned Work-result selection contract.
- [ ] Provide an official consumer decoder/selection port owned by Doc-Vader.
- [ ] Add producer and consumer-facing compatibility/regression tests.
- [ ] Document capabilities, version negotiation, unsupported-version failure,
      and consumer integration.
- [ ] Provide a command/JSON transport bridge usable by Node 20 consumers
      without importing the Doc-Vader runtime.
- [ ] Coordinate acceptance evidence with Babysitter-DV through
      `ttr-33dc818c-e50f-4513-bd02-cc60e8143b3f`.

## Deliverables

- Stable published Work-result contract and official decoder.
- Consumer integration guidance and acceptance evidence.
- Focused producer/consumer compatibility tests.

## Acceptance Criteria

- [ ] Doc-Vader is the sole owner of Work-result schema and readiness semantics.
- [ ] A consumer can select ready Work through an explicit Doc-Vader-owned,
      versioned interface without copied schema semantics.
- [ ] Unsupported or malformed results fail closed before effects and echo the
      invoked requested capability for evidence.
- [ ] Capability discovery publishes explicit request/response version mapping.
- [ ] The JSON-safe decision artifact always includes the invoked command and
      opaque source-result evidence.
- [ ] No Agent Workflows integration is added or required.
- [ ] Focused tests, typecheck, docs lint, backlog validation, and diff checks
      pass.

## Transport

The resource-scoped Node 20 transport is `dv work capabilities <work-item-id> --json` and `dv work select <work-item-id> --request <json-file|-> --json`. The request identity must equal `<work-item-id>`; there is no unscoped `dv work capabilities` or `dv work select` surface.

## Implementation Notes

- Keep consumer code limited to official-port invocation and boundary failure
  handling; do not copy Doc-Vader schema semantics.
- Coordinate interface/version/capabilities with Babysitter-DV only.
