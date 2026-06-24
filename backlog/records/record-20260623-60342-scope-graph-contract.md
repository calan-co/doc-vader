---
$schema: schemas/work-management/frontmatter/record.json
id: record:20260623-60342-scope-graph-contract
title: Deferred scope graph contract for wi-60342
summary: Records the deferred canonical scope graph, storage, command surface, and fail-closed lookup contract for wi-60342.
type: record
subtype: evidence
lifecycle: active
status: ready
status_reason: noted
links:
  supporting_reference:
    - '[[60342-task-scope-reservation-and-lookup]]'
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
    - '[[60340-artifact-graph-and-nested-claim-architecture-adr]]'
---

## Recorded At

2026-06-23T04:37:53Z

## Outcome

noted

## Observation

This record captures the deferred scope-graph reservation and lookup contract for
wi-60342. It does not introduce runtime commands or implementation behavior in
the MVP command surface.

## Deferred Contract

- The future canonical scope graph payload is a JSON object with an explicit
  schema version, task identity, canonical graph structure, provenance, and
  derived hash metadata.
- Canonicalization must be deterministic before hashing: UTF-8 JSON text,
  recursively sorted object keys, no insignificant whitespace, JSON-compatible
  values only, and stable array order where the graph semantics require it.
- Identical canonical payloads must produce the same `scope_hash`; any semantic
  payload change must produce a new `scope_hash`.
- The future runtime store should live under the configured Doc-Vader runtime
  directory, such as `.doc-vader/runtime/`, and remain runtime-owned rather than
  Git-managed.
- The future store must support lookup by task ID and by `scope_hash` without
  committing runtime state into durable repository artifacts.
- Future command contracts are reserved for `reserve`, `scopes`, `scope`, and
  scope-derivation flows. `reserve` stores or recovers a scope graph and
  returns a hash without creating an execution claim.
- `--dry-run` reports the would-be hash and validation result without
  persisting state.
- Scope lookup must fail closed for unclaimable work, including missing,
  archived, blocked, HITL, invalid, or already-claimed work items.
- Scope derivation must produce a new graph hash and must never mutate an
  existing hash.
- Nested artifact and section-level claim behavior remains deferred to
  [[60340-artifact-graph-and-nested-claim-architecture-adr]].

## Future Tests

- Stable hash behavior for identical and changed canonical graphs.
- Duplicate payload recovery versus new payload creation.
- Malformed payload rejection.
- Unclaimable task rejection.
- Dry-run validation without persistence.
- Lookup by task ID and by `scope_hash`.

## Validation

- `pnpm exec vitest run tests/scope-graph-contract.test.ts`
- `pnpm run docs:lint`
- `pnpm run backlog:validate:ci`
- 2026-06-24: Revalidated on `sandcastle/issue-60342` with `pnpm run docs:lint`, `pnpm run backlog:validate`, `pnpm run backlog:validate:ci`, `pnpm run typecheck`, and `pnpm exec vitest run tests/scope-graph-contract.test.ts`.
