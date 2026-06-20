---
$schema: /frontmatter/document
id: adrrunti-6294
title: Use Git plus SQLite as the local runtime authority
type: document
subtype: generic
status: ready
lifecycle: active
tags:
  - adr
  - architecture
  - runtime
  - sqlite
links:
  reference:
    - '[[../../../backlog/60361-git-sqlite-local-multi-agent-runtime-contract]]'
    - '[[../../../backlog/60362-runtime-sqlite-store-and-migrations]]'
    - '[[../../../backlog/60363-runtime-entity-schemas]]'
    - '[[adr-009-storage-and-format-seams.md]]'
---

## Context and Problem Statement

The Sandcastle dogfood MVP used a local JSON claim store. The active runtime
roadmap now requires local multi-agent execution with atomic claim creation,
file locks, execution logs, halt/recover semantics, and changed-file lock
audits.

Older work items proposed scope reservations and immutable scope graphs as the
implementation center. That model is too heavy for the current local MVP and
does not match the newer runtime contract.

## Decision

For the local runtime MVP, Doc-Vader uses one Git repository plus one SQLite
runtime authority.

SQLite owns runtime coordination tables for claims, locks, and execution log
entries. Git remains the durable source for repository artifacts and changed
file detection. Claim creation and lock acquisition are transactional runtime
operations. File lock identity is normalized repo-relative path identity for the
MVP.

This is an adapter choice, not a semantic dependency. Runtime entity governance
must flow through the storage and format seams defined in ADR-009 so future
hosted or file-backed adapters can reuse the same entity contracts.

Hosted authority, multi-repository coordination, immutable scope graphs,
section-level claims, revocation semantics, and artifact graph claims are
deferred.

## Decision Drivers

- Local multi-agent work needs atomic coordination and structured recovery.
- A JSON claim store is insufficient for claims, locks, execution state, and
  audit queries.
- Git already provides durable artifact history and changed-file detection.
- Storage and format choices must be explicit seams even when MVP adapter
  coverage is narrow.
- The MVP must avoid hardening deferred artifact graph assumptions.

## Consequences

Positive:

- Runtime ownership and execution state can be tested transactionally.
- Claims, locks, and execution logs become generic runtime entities.
- Later hosted authority can map from the same entity concepts.

Negative/Risks:

- Runtime state and repository artifacts now have separate persistence channels.
- Commands must be explicit about what is durable Git state and what is runtime
  SQLite state.
- Existing scope-reservation backlog items require reconciliation.

## Validation

- Runtime entity schemas and SQLite migrations are implemented before command
  expansion.
- Claim and lock acquisition is atomic.
- Changed-file lock audit blocks terminal success when modified paths are not
  covered by active claim-owned locks.
