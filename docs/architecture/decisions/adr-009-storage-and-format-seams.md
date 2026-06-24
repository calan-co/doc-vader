---
$schema: /frontmatter/document
id: adrstora-2746
title: Define storage and format seams for governed entities
type: document
subtype: generic
status: ready
lifecycle: active
tags:
  - adr
  - architecture
  - entity-governance
  - storage
links:
  reference:
    - '[[adr-005-entity-governance-primitive-model.md]]'
    - '[[adr-007-local-runtime-authority-git-sqlite.md]]'
    - '[[../../how-to/implementation-plans/doc-vader-entity-governance-architecture-prd.md]]'
---

## Context and Problem Statement

Doc-Vader currently governs Markdown files with YAML frontmatter, JSON payloads,
schema files, and a planned SQLite runtime authority. The entity governance model
must support package-authored entities and future storage choices without
hard-coding every rule to a specific persistence medium or file format.

At the same time, the MVP must stay small enough to deliver. The seam must be
defined now, while adapter coverage can remain narrow.

## Decision

Doc-Vader separates governed entity semantics from storage medium and document
format.

The MVP defines two explicit seams:

- `Storage Adapter`: loads, persists, queries, and transactions over a storage
  medium such as Git-managed files, SQLite runtime tables, or future hosted
  storage.
- `Format Adapter`: parses, serializes, and canonicalizes a concrete format such
  as Markdown with YAML frontmatter, JSON payloads, JSON Schema, or future custom
  formats.

Entity governance modules consume canonical entity records, runtime records, and
finding inputs. They do not directly depend on Markdown, JSON, SQLite, or file
path layout except through adapters.

MVP adapter coverage is intentionally minimal:

- Git-managed file storage for durable repository artifacts.
- Markdown plus YAML frontmatter format for documents and work items.
- JSON format for PRD sidecars, command payloads, runtime payloads, and reports.
- SQLite storage for local runtime entities: claims, locks, and execution log
  entries.

The seam is required in MVP even when only one adapter exists for a storage type
or format. Additional adapters are deferred until a concrete package or hosted
authority requires them.

## Decision Drivers

- Package authors need stable extension points for custom entities and formats.
- Consumers need consistent behavior whether an entity is Markdown-backed,
  JSON-backed, or runtime-backed.
- Runtime state and durable repository artifacts use different persistence
  channels and must not leak storage details into governance rules.
- Defining the seam late would force expensive refactoring after Work Item and
  runtime behavior harden.

## Consequences

Positive:

- Work Item Governance Kernel can operate on canonical records instead of raw
  files.
- Runtime entities can share governance concepts without pretending SQLite rows
  are Markdown documents.
- Package authors get a clear place to extend storage or format behavior.

Negative/Risks:

- The MVP may have seams with only one adapter. These seams must stay small and
  concrete to avoid speculative abstraction.
- Tests must verify canonicalization across adapter boundaries, not only raw
  parser behavior.

## Validation

- Work Item and runtime governance code accepts canonical records or finding
  inputs rather than raw storage-specific structures.
- Markdown/YAML, JSON, and SQLite behavior is covered by adapter tests.
- New package-authoring guidance names storage and format adapters separately.
