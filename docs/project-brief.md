---
id: doc-vader-project-brief
title: Doc-Vader Project Brief
type: document
subtype: brief
lifecycle: active
status: proposed
tags:
  - architecture
  - validation
  - backlog-hygiene
links:
  project:
    - "[[docs/how-to/implementation-plans/doc-vader-shared-engine-mvp.plan.md]]"
---

## Overview

Doc-Vader is the shared validation engine for documentation governance, backlog conformance, and workflow guardrails across projects such as `templjs` and `pax`.

## Current MVP Objectives

- Provide a single, deterministic validation engine for docs and backlog metadata.
- Enforce closure-compatible backlog semantics (`status: closed` + `status_reason`).
- Provide strict, CI-safe gate controls (`--fail-on`, `--format json`, `--profile`).
- Maintain low-friction compatibility with legacy status/link/frontmatter patterns.

## Scope

- Core engine and schema alignment in `doc-vader`.
- Backlog hygiene lane: audit, remediation, closure/finalization, reconciliation.
- Consumer-ready interfaces for downstream repositories.

## Success Criteria

- Backlog audit is reproducible and machine-readable.
- Active backlog items validate against current schemas.
- Closed items are archived with evidence and reason metadata.
- CI can fail deterministically on hygiene violations.

