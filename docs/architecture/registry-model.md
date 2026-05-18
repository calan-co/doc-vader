---
title: Cross-File Registry Model
id: registrym-2280
type: document
subtype: generic
lifecycle: active
status: ready
tags:
  - registry
  - graph
  - naming
links:
  reference:
    - '[[174.cross-file-graph-and-naming-feature.md]]'
    - '[[174.1.graph-and-naming-story.md]]'
    - '[[228.design-cross-file-registry-model-story.md]]'
---

## Goal

Define a deterministic cross-file registry model for graph and naming validation.

## Registry Entities

1. `node`: parsed source file with frontmatter identity, path, type/subtype, and references.
2. `edge`: directed relationship from source node to referenced target.
3. `resolution`: mapping of unresolved reference token to a canonical file target or failure reason.

## Lookup Semantics

1. Resolve by explicit path match first.
2. Resolve by basename fallback only if unique.
3. Resolve with deterministic candidate ordering:
   - backlog/
   - docs/
   - schemas/
4. Mark unresolved when no candidate exists.

## Conflict Rules

1. Duplicate node identity is a hard error.
2. Ambiguous basename resolution is a hard error.
3. Missing target is an unresolved-link error.
4. Cycles are valid graph structures unless policy marks them invalid for a relation type.

## Trace Output

Each resolution should emit machine-readable trace fields:

- `source`
- `token`
- `candidates`
- `winner` (or `null`)
- `reason` (`path-match`, `basename-match`, `ambiguous`, `not-found`)

## Cache and Invalidation

1. Cache registry entries by file path plus mtime.
2. Invalidate cache on mtime change.
3. Rebuild only changed nodes and affected resolution indexes when possible.

## Test Fixture Set

Fixtures are defined in `tests/fixtures/registry/registry-cases.json`:

1. basic-resolution
2. missing-target
3. duplicate-id
4. ambiguous-basename
5. cycle-detection
