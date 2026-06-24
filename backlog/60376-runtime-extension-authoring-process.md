---
id: wi-60376
title: Runtime Extension Authoring Process
summary: Define the reusable process for adding runtime entities, storage and format adapters, execution state transitions, and command scripts without duplicating claim or lock command logic.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 3
actual: 3
completed_date: '2026-06-20'
links:
  depends_on:
    - '[[60363-runtime-entity-schemas]]'
  reference:
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
  evidence:
    - '[[task-record-preflight]]'
    - '[[record-sandcastle-task-validation-passed]]'
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

## Process

### Canonical implementation order

When a future runtime capability is added, define it in this order:

1. Schema and validator boundary.
2. Storage shape and persistence contract.
3. Format adapter boundary, if the capability crosses document or payload formats.
4. Command wiring and state transition behavior.
5. Test fixtures and conformance coverage.
6. Documentation and cross-reference updates.

This order keeps runtime shape, durable storage, parsing, and command behavior aligned before integration work starts.

### Runtime entity checklist

- Define the canonical record shape first, including versioning, required identifiers, and any derived or generated fields.
- Add the SQLite table or view that persists or derives the entity state.
- Add the TypeScript model or validator used before any durable write.
- Add store methods for create, query, update, and cleanup flows that match the entity lifecycle.
- Add representative valid and invalid fixtures.
- Add migration tests that prove initialization, schema compatibility, and idempotent setup behavior.

### Storage adapter checklist

- Define the capability contract in terms of load, persist, query, and transaction semantics.
- Specify conflict behavior up front, including whether the adapter fails closed, merges, or rejects on collision.
- Describe migration and bootstrap behavior, including how the adapter initializes durable state.
- State durability expectations, including atomicity boundaries and rollback behavior.
- Add conformance tests that cover initialization, conflict handling, transaction boundaries, and recovery from partial failure.

### Format adapter checklist

- Define parse and serialize contracts before tying the adapter to a storage backend.
- Map each format payload to one canonical record shape.
- Specify the schema-validation boundary and where invalid input fails.
- Normalize error shape so parse failures and validation failures are distinguishable.
- Add round-trip fixtures for the supported format inputs and outputs.
- Add conformance tests for parse, serialize, canonical mapping, and invalid payload rejection.

### Execution state transition checklist

- Define the allowed state/reason pair before adding command logic.
- Append one bounded execution-log entry for each state transition.
- Clean up runtime ownership only after the execution-log entry is written successfully.
- State the idempotency rule for repeated terminal transitions.
- State the failure semantics when cleanup, logging, or validation fails.
- Cover the transition paths used by `halt`, `fail`, `complete`, and `recover`.

### Command script checklist

- Define the command grammar, including selector syntax and required positional arguments.
- Define selector rules, including when bare mutating commands must fail closed and show help.
- Define dry-run semantics before mutation implementation.
- Define JSON and porcelain output shapes where machine consumers need stability.
- Define help text and error payloads so invalid input is actionable without guessing.
- Add conformance tests that cover selectors, dry-run, output formats, and structured errors.

### Task Markdown lifecycle boundary

- Work-item Markdown status may change only through work-item lifecycle commands and backlog-authoring paths that explicitly own lifecycle progression.
- Runtime commands such as claim transitions, lock mutations, record writes, and runtime cleanup must not mutate work-item Markdown status directly.
- Execution-log state and work-item status remain separate concerns; claim-scoped commands only record execution state and ownership cleanup.

### Reusable test expectations

- `halt` should append `halted/<reason>`, persist the guardrail entry, and remove runtime ownership.
- `fail` should append `failed/error`, persist the guardrail entry, and remove runtime ownership.
- `complete` should append `completed/success`, persist the success entry, and remove runtime ownership only after durable writes succeed.
- `recover` should create a fresh execution attempt, acquire ownership through the normal claim path, and only succeed when the target is safe to resume.
- Shared tests should verify that execution-log entries are bounded, state/reason pairs are valid, and lifecycle progression does not leak through runtime commands.

### Dependency declaration

- New runtime capability work items should link the schema slice first, then the storage slice, then the command-surface slice, and finally the integration-test slice that proves the end-to-end behavior.
- If a capability crosses format boundaries, include the format-adapter slice in the dependency chain.
- Downstream claim-command work items should reference this process instead of restating the generic implementation sequence.

## Tasks

- [x] Define the checklist for adding a runtime entity: schema, SQLite table or view, TypeScript model, validator, store methods, fixtures, and migration tests.
- [x] Define the checklist for adding a storage adapter: capability contract, transaction semantics, conflict behavior, migration/bootstrap behavior, durability expectations, and conformance tests.
- [x] Define the checklist for adding a format adapter: parse/serialize contract, canonical record mapping, schema validation boundary, error shape, round-trip fixtures, and conformance tests.
- [x] Define the checklist for adding an execution state transition: allowed state/reason pair, execution-log append behavior, runtime ownership cleanup behavior, idempotency rules, and failure semantics.
- [x] Define the checklist for adding a command script: command grammar, selector rules, dry-run behavior, JSON/porcelain output, help text, and error payloads.
- [x] Define where task Markdown lifecycle progression is allowed and where runtime commands must not mutate work-item status.
- [x] Add reusable test expectations for state transition commands such as `halt`, `fail`, `complete`, and `recover`.
- [x] Document how new runtime capabilities declare dependencies on schemas, storage, command surface, and integration-test slices.

## Deliverables

- Runtime extension authoring checklist.
- Storage adapter and format adapter authoring checklist.
- Command-script implementation checklist.
- Test template or shared test helper guidance for runtime command verbs.
- Documentation that separates execution state transitions from task lifecycle progression.

## Acceptance Criteria

- [x] A future contributor can add a runtime entity without inventing schema, migration, validator, and command wiring order.
- [x] A future contributor can add storage or format support without coupling governance semantics to SQLite, Markdown/YAML, JSON, or file layout.
- [x] A future contributor can add a state transition command without confusing execution-log state with work-item Markdown status.
- [x] Command scripts have one documented pattern for selectors, output formats, dry-run, and structured errors.
- [x] Existing claim command work items can reference this process instead of restating generic implementation steps.
- [x] The process explicitly covers `halt`, `fail`, `complete`, and `recover` as examples.

## Blocked By

- [[60363-runtime-entity-schemas]]
