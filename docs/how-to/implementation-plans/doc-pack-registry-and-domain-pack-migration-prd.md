---
# yaml-language-server: $schema=https://raw.githubusercontent.com/calan-co/doc-vader/main/schemas/work-management/frontmatter/prd.json
"$schema": "https://raw.githubusercontent.com/calan-co/doc-vader/main/schemas/work-management/frontmatter/prd"
"$content_schema": schemas/work-management/content/prd.json
"$template": templates/reference/work-management/prd.md.tpl
"type": plan
"subtype": x-prd
"id": "plan:doc-pack-registry-and-domain-pack-migration-prd"
"title": "Doc-Pack Registry and Domain Pack Migration PRD"
"lifecycle": active
"status": ready
"summary": "Create a domain-level doc-pack platform through gated AFK phases while keeping the registry a small catalog-only module."
---

## Artifact Strategy

- Source of truth: `json-payload`
- Rendered views: `markdown`
- Preservation: The JSON sidecar beside this PRD is the source of truth. This
  Markdown view records the execution contract and links to decomposed work.

## Context Grounding

Doc-Vader already defines metadata routing and a `document-type-pack` manifest,
but schemas, templates, semantic contexts, profiles, and workflow assets remain
under repository-root directories. Many runtime consumers use those paths
directly. A pack mechanism must support reusable domain assets without making a
registry responsible for sourcing, executing, hosting, lifecycle, or domain
behavior.

### Domain Vocabulary

- doc-pack
- document-type contribution
- DocPackRegistry
- metadata
- body/content model
- renderer template
- semantic context
- opaque reference
- activation host

### ADR Alignment

This plan extends
[`ADR-011`](../../architecture/decisions/adr-011-document-pack-routing-and-config.md).
Canonical routing remains metadata-based. “Frontmatter” remains only a Markdown
format-adapter term.

## Problem Statement

A repository-root asset layout prevents independently reusable documentation
domains and leaves internal callers coupled to file locations. Introducing an
all-purpose package manager would overengineer the need: the immediate problem
is cataloging validated packs and resolving their declared references.

## Solution

Introduce domain-level doc-packs in four gated phases. Define a `doc-pack`
manifest distinct from the existing `document-type-pack` contribution
descriptor. Implement a catalog-only registry. Migrate `sdlc-core` as a pilot
with no legacy aliases. Then migrate the remaining domains independently.

## Architecture and Ownership

### Manifest roles

`document-type-pack` remains a focused descriptor of document types and their
metadata/body models, renderer templates, routing defaults, and handlers.

`doc-pack` is the encompassing domain-bundle descriptor. It identifies a pack,
declares dependencies, collects artifacts and document-type contributions,
declares embedded or referenced extensions, and establishes pack-local tests
and fixtures.

### DocPackRegistry

The registry owns only:

- registration and master identity of doc-packs;
- pack and registration validation;
- the authoritative list of registered packs; and
- resolution of consumable or executable references from registered packs.

It does **not** own sourcing packs from disk, URLs, package managers, or
configuration; runtime loading, execution, sandboxing, or hosting; business
rules; activation; installation; updates; or lifecycle management. It returns
opaque references. A source adapter supplies candidates, and a runtime host or
consumer decides how to consume a resolved reference.

### Extensions and third-party packs

A pack may declare an embedded extension for bespoke behavior or a referenced
extension for reusable behavior. The registry validates and resolves these
declarations but never executes them. Activation is outside the registry and
must require explicit consent when executable code is involved.

For MVP and beyond, Doc-Vader uses a static third-party disclaimer: packs and
extensions not authored by Doc-Vader are not reviewed, endorsed, sandboxed, or
guaranteed by Doc-Vader; users must enable only sources they trust. No digests,
attestations, trust levels, expiry, or revocation model is in scope.

### Artifact and terminology model

Use syntax-agnostic terms: metadata model, body/content model, renderer
template, semantic context, and artifact. JSON-LD contexts are optional
`semantic-context` artifacts. A pack must define stable metadata semantics but
need not publish JSON-LD; it may reuse or extend a `core` semantic context.

Do not retain internal legacy-path aliases. New consumers resolve logical pack
artifact references; a broken old internal path is an intentional migration
failure.

## Domain Model and Migration Order

| Domain pack | Scope | Dependency notes |
| --- | --- | --- |
| `core` | Shared metadata model, constraints, routing, semantic contexts, renderer primitives | Reused by all domain packs |
| `sdlc-core` | PRD, BRD, SAD, ADR, roadmaps, test plans, work/planning/release/record artifacts and associated policies | Pilot after registry |
| `diataxis` | Tutorial, how-to, reference, explanation | Depends on `core` |
| `agile` | Retrospectives, stand-ups, team agreements, sprint artifacts | Depends on `core` |
| `c4`, `rfx`, `dita`, `para` | Their coherent domain artifacts | Each is independently planned and gated |
| `operations` | Runbooks and playbooks when operational material becomes a cohesive domain | Initially may be provisionally in `sdlc-core` |

Release notes belong in `sdlc-core` when they encode delivery governance; they
belong in a product-documentation domain when they communicate product changes
to end users.

## AFK Execution Contract

Every phase uses one isolated worktree and one mutation-capable writer. After
the writer handoff, fresh-context read-only reviewers independently inspect
architecture, scope, and tests. The writer resolves verified findings, then the
phase gate runs against the current commit. The next phase may begin only when
the gate is clear and the reviewed commit matches the validated commit.

Stop rather than proceed if a command fails, a review finding is unresolved, the
base revision changes, or an unrecorded product decision is required.

### Phase 1 — Contract and inventory

Deliver:

- `doc-pack` manifest contract and documentation;
- catalog-only registry interface documentation;
- inventory of all built-in artifacts, consumers, dependencies, proposed domain
  owner, logical artifact ID, and hard-coded path replacement;
- extension declaration and explicit-consent policy;
- pack-local test/fixture convention; and
- deterministic phase verification entry point.

Do not move assets, migrate callers, source packs, execute extensions, or add
compatibility shims.

Gate:

```bash
pnpm exec vitest run tests/config-schema.test.ts
pnpm run typecheck
pnpm run docs:lint
pnpm test -- --run
git diff --check
pnpm exec tsx scripts/verify-doc-pack-phase.ts --phase 1
```

### Phase 2 — Registry and conformance

Implement public registration, validation, `get`, `list`, and logical-reference
resolution. Validate identity, dependencies, collisions, in-pack references,
and declared extension references. Do not source or execute packs/extensions,
manage activation/lifecycle, apply business rules, or add aliases.

Gate:

```bash
pnpm exec vitest run tests/doc-pack-registry.test.ts tests/doc-pack-conformance.test.ts tests/config-schema.test.ts
pnpm run typecheck
pnpm test -- --run
pnpm run docs:lint
git diff --check
# Extend and run the phase verifier with registry behavior checks.
```

### Phase 3 — `sdlc-core` pilot

Move the agreed SDLC artifacts into `sdlc-core`, including pack-owned metadata
and body/content models, renderer templates, workflow/status assets, semantic
contexts where useful, tests, and fixtures. Replace affected internal direct
paths with logical references. Delete obsolete path assumptions without aliases.

Gate:

```bash
pnpm exec vitest run tests/doc-pack-registry.test.ts tests/prd.test.ts tests/work-management.test.ts tests/backlog-synthesis.test.ts tests/canonical-task-model.test.ts
pnpm run typecheck
pnpm run build
pnpm test -- --run
pnpm run docs:lint
git diff --check
# Run the Phase 3 verifier added with this migration.
```

### Phase 4 — Remaining domains

Migrate `core`, then independently migrate `diataxis`, `agile`, `c4`, `rfx`,
`dita`, `para`, and `operations` when approved. Each domain has its own work
item, worktree, pack-local fixtures, focused consumers, reviews, and gate.

Generic gate:

```bash
pnpm exec vitest run tests/doc-pack-registry.test.ts tests/<domain>.test.ts
pnpm run typecheck
pnpm run build
pnpm test -- --run
pnpm run docs:lint
git diff --check
# Run the domain-specific Phase 4 verifier added with this migration.
```

## Testing Decisions

Test public registry behavior, manifest conformance, pack-owned artifact
behavior, and migrated command behavior. Keep package-specific tests and
fixtures inside each pack. Root tests only verify registry behavior,
cross-pack dependencies, and repository-level consumer integration.

## Out of Scope

- Source adapters and package discovery.
- Runtime loading/execution/hosting or sandboxing.
- Registry trust/attestation systems.
- External-consumer compatibility aliases.
- Bulk migration of all domains.

## Success Criteria

- The artifact inventory and path map are committed before migrations begin.
- The registry remains catalog-only.
- `sdlc-core` has no legacy aliases and preserves validated consumer behavior.
- Each migrated pack owns tests and fixtures.
- Every phase has a structured acceptance report and fresh validation evidence.

## Agent Handoff

- Use TDD for each vertical slice.
- Use managed worktrees and one writer per phase.
- Run independent read-only review before the final gate.
- Record changed files, tests, commands, validation output, residual risks, and
  the validated commit in each phase acceptance report.
