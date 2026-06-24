---
id: wi-60383
title: Composable Evaluation Framework Foundation
summary: Implement the shared Check, Finding, Review Profile, Review, Report, and Summary contracts without binding them to backlog-specific behavior.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: high
estimated: 5
actual: 5
completed_date: '2026-06-23'
links:
  depends_on:
    - '[[60377-work-item-governance-kernel]]'
  reference:
    - '[[../CONTEXT.md]]'
    - '[[../docs/architecture/decisions/adr-005-entity-governance-primitive-model.md]]'
    - '[[../docs/architecture/decisions/adr-010-composable-evaluation-primitives.md]]'
  evidence:
    - '[[record-20260624-234349-60383]]'
tags:
  - afk
  - architecture
  - extensibility
  - findings
  - review
---

## Goal

Implement the shared evaluation contracts needed for Doc-Vader checks,
findings, review profiles, reviews, reports, and deterministic summaries before
building store-specific review profiles.

## Background

Backlog review should be the first Work Item review profile, not the place where
the entire evaluation framework is invented. This slice creates the reusable
contracts and minimal orchestration needed by native Doc-Vader domains and future
packages.

`Run` remains reserved and should not be introduced as a first-class API unless
the implementation discovers a concrete need for durable in-flight check
execution state.

## Tasks

- [x] Define shared TypeScript contracts for check input, check output,
      findings, review profiles, review execution, reports, and deterministic
      summaries.
- [x] Define stable finding fields, including subject, check identifier,
      disposition, severity, reason code, evidence, blocking status, and
      optional follow-up references.
- [x] Define review profile registration or discovery seams that can support
      native domains and future packages without hard-coding backlog behavior.
- [x] Define deterministic report assembly from findings and declared summary
      rules.
- [x] Keep synthesis out of the foundation implementation except for explicit
      extension points or placeholders required by the output contract.
- [x] Add focused tests for contract stability, deterministic summary ordering,
      and profile composition behavior.
- [x] Document how Work Item governance can consume the shared framework without
      moving Work Item rules into the framework layer.

## Deliverables

- Shared evaluation contracts.
- Minimal profile composition and report assembly implementation.
- Tests for deterministic report and summary behavior.
- Developer documentation or inline reference showing intended usage by backlog
  review.

## Acceptance Criteria

- [x] The implementation is not coupled to Work Item, backlog, Markdown, JSON,
      SQLite, or file-based storage specifics.
- [x] Checks produce findings with stable reason codes and evidence references.
- [x] Review profiles can compose multiple checks and deterministic summaries.
- [x] Reports can be serialized for CLI/API consumers.
- [x] No lifecycle transitions, checkbox mutations, claim mutations, or records
      are written by the framework foundation.
- [x] Tests prove repeated runs over the same inputs produce stable report
      ordering.
- [x] Validation passes with `pnpm run docs:lint`.
- [x] Validation passes with `pnpm run backlog:validate`.

## Relationships

- `depends_on`: `[[60377-work-item-governance-kernel]]`
