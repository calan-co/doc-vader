---
id: docvader-758
title: Doc-Vader Project Brief
type: document
subtype: brief
lifecycle: active
status: ready
tags:
  - architecture
  - validation
  - backlog-hygiene
links:
  project:
    - '[[docs/how-to/implementation-plans/doc-vader-shared-engine-mvp.plan.md]]'
    - '[[docs/how-to/implementation-plans/doc-vader-entity-governance-architecture-prd.md]]'
  reference:
    - '[[adr-005-entity-governance-primitive-model.md]]'
    - '[[adr-009-storage-and-format-seams.md]]'
---

## Overview

Doc-Vader is an entity-governance runtime for applying custom rigors to extensible repository entities. Documentation validation, backlog conformance, task execution, evidence records, and workflow guardrails are built-in packages over that runtime for projects such as `templjs` and `pax`.

## Current MVP Objectives

- Define canonical primitives for artifacts, entities, gates, records, storage adapters, and format adapters.
- Keep Work Item as the canonical repository entity while exposing Task as the agent/Sandcastle command projection.
- Provide a deterministic governance kernel for docs and backlog metadata.
- Enforce closure-compatible backlog semantics (`status: closed` + `status_reason`).
- Provide strict, CI-safe gate controls (`--fail-on`, `--format json`, `--profile`).
- Establish Git plus SQLite as the local runtime authority while keeping storage and format seams explicit.
- Maintain low-friction compatibility with legacy status/link/frontmatter patterns.

## Scope

- Core entity-governance engine and schema alignment in `doc-vader`.
- Backlog hygiene lane: audit, remediation, closure/finalization, reconciliation.
- Local runtime lane: claims, file locks, execution logs, and claim lifecycle commands.
- Consumer-ready interfaces for downstream repositories.
- Package-author interfaces for extending entities, policies, adapters, and command projections.

## Success Criteria

- Backlog audit is reproducible and machine-readable.
- Active backlog items validate against current schemas.
- Closed items are archived with evidence and reason metadata.
- CI can fail deterministically on hygiene violations.
- Runtime claims, locks, and execution logs prevent conflicting local agent execution.
- Custom packages can extend governance behavior without coupling to Markdown, JSON, SQLite, or file layout.
