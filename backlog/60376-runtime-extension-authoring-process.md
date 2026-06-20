---
id: wi-60376
title: Runtime Extension Authoring Process
summary: Define the reusable process for adding runtime entities, storage and format adapters, execution state transitions, and command scripts without duplicating claim or lock command logic.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: prioritized
priority: high
estimated: 3
links:
  depends_on:
    - '[[60363-runtime-entity-schemas]]'
  reference:
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
tags:
  - afk
  - runtime
  - process
  - command-surface
---

## Goal

Create a reusable implementation process for extending the runtime with new entities, storage adapters, format adapters, state transitions, and command scripts.

## Background

The runtime contract now separates task Markdown progression from claim execution state. Claim-scoped commands such as `complete`, `fail`, `halt`, and `recover` append bounded execution-log entries and clean up runtime ownership; they do not directly progress work-item Markdown. Adding future entities, adapters, or command verbs should follow one repeatable path so behavior, schemas, storage, format parsing, command wiring, tests, and documentation do not drift.

Architectural context: `docs/architecture/decisions/adr-009-storage-and-format-seams.md`.

## Tasks

- [ ] Define the checklist for adding a runtime entity: schema, SQLite table or view, TypeScript model, validator, store methods, fixtures, and migration tests.
- [ ] Define the checklist for adding a storage adapter: capability contract, transaction semantics, conflict behavior, migration/bootstrap behavior, durability expectations, and conformance tests.
- [ ] Define the checklist for adding a format adapter: parse/serialize contract, canonical record mapping, schema validation boundary, error shape, round-trip fixtures, and conformance tests.
- [ ] Define the checklist for adding an execution state transition: allowed state/reason pair, execution-log append behavior, runtime ownership cleanup behavior, idempotency rules, and failure semantics.
- [ ] Define the checklist for adding a command script: command grammar, selector rules, dry-run behavior, JSON/porcelain output, help text, and error payloads.
- [ ] Define where task Markdown lifecycle progression is allowed and where runtime commands must not mutate work-item status.
- [ ] Add reusable test expectations for state transition commands such as `halt`, `fail`, `complete`, and `recover`.
- [ ] Document how new runtime capabilities declare dependencies on schemas, storage, command surface, and integration-test slices.

## Deliverables

- Runtime extension authoring checklist.
- Storage adapter and format adapter authoring checklist.
- Command-script implementation checklist.
- Test template or shared test helper guidance for runtime command verbs.
- Documentation that separates execution state transitions from task lifecycle progression.

## Acceptance Criteria

- [ ] A future contributor can add a runtime entity without inventing schema, migration, validator, and command wiring order.
- [ ] A future contributor can add storage or format support without coupling governance semantics to SQLite, Markdown/YAML, JSON, or file layout.
- [ ] A future contributor can add a state transition command without confusing execution-log state with work-item Markdown status.
- [ ] Command scripts have one documented pattern for selectors, output formats, dry-run, and structured errors.
- [ ] Existing claim command work items can reference this process instead of restating generic implementation steps.
- [ ] The process explicitly covers `halt`, `fail`, `complete`, and `recover` as examples.

## Blocked By

- [[60363-runtime-entity-schemas]]
