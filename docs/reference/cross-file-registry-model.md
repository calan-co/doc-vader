---
id: crossreg-228
title: Cross-File Registry Model
type: document
subtype: reference
lifecycle: draft
status: proposed
tags:
  - registry
  - graph
  - reference
  - architecture
links:
  related:
    - '[[remark-lint-unified-architecture.md]]'
    - '[[../../backlog/228.design-cross-file-registry-model-story.md]]'
    - '[[../../backlog/174.cross-file-graph-and-naming-feature.md]]'
---

## Purpose

This document defines the cross-file registry abstraction used by Epic 170 Track C
plugins (crossref, naming conventions, backlog semantics, lifecycle rules). The
registry provides a single pre-scanned project view that plugins query instead of
performing per-file I/O on each lint invocation.

## Core Types

```typescript
/** A single file entry in the registry. */
export interface RegistryNode {
  /** Workspace-relative file path, e.g. "backlog/100.alpha.md". */
  file: string;
  /** Frontmatter `id` field, if present. */
  id: string | undefined;
  /** All wikilink-style refs found in the body, e.g. ["[[101.beta.md]]"]. */
  refs: string[];
  /** All heading slugs and explicit `id:` anchors exported by this file. */
  anchors: string[];
  /** mtime at the time of scan, used for cache invalidation. */
  mtime: number;
}

/** Result of a lookup operation. */
export type LookupResult =
  | { found: true; node: RegistryNode }
  | { found: false; reason: 'missing-target' | 'ambiguous' };

/** A detected duplicate-id entry. */
export interface DuplicateEntry {
  id: string;
  files: string[];
}

/** A detected reference cycle. */
export interface Cycle {
  path: string[]; // ordered list of files forming the cycle
}

/** Registry error variants reported to lint rules. */
export type RegistryError =
  | { kind: 'missing-target'; ref: string; sourceFile: string }
  | { kind: 'duplicate-id'; id: string; files: string[] }
  | { kind: 'cycle'; path: string[] }
  | { kind: 'ambiguous'; ref: string; candidates: string[] };
```

## Registry Interface

```typescript
export interface ProjectRegistry {
  /**
   * Scan one or more root directories and populate the registry.
   * Returns self for chaining.
   * Subsequent calls invalidate entries whose mtime has changed.
   */
  scan(roots: string[]): Promise<this>;

  /**
   * Look up a file by basename, relative path, or `[[wikilink]]` syntax.
   * Returns LookupResult. Ambiguous matches (same basename, multiple dirs)
   * return `{ found: false, reason: 'ambiguous' }`.
   */
  lookup(ref: string): LookupResult;

  /**
   * Look up a specific anchor within a file.
   * Returns true when the anchor exists in the resolved node.
   */
  hasAnchor(file: string, anchor: string): boolean;

  /** Return all nodes with the same `id` field value. */
  findDuplicates(): DuplicateEntry[];

  /**
   * Detect reference cycles in the `refs` graph.
   * Uses iterative DFS; returns one representative path per cycle.
   */
  detectCycles(): Cycle[];

  /** Return all accumulated errors from the last scan. */
  errors(): RegistryError[];

  /** Invalidate cached entries whose mtime has changed. */
  invalidate(): Promise<void>;
}
```

## Resolution Algorithm

1. **Exact relative path** — if the ref matches a known `node.file` exactly
   (or after normalising `./` prefix), return that node directly.
2. **Wikilink basename** — strip `[[` / `]]` markers and match against the
   basename of every registered file. If exactly one match, return it.
3. **Ambiguous** — if step 2 yields more than one candidate, return
   `{ found: false, reason: 'ambiguous' }` and record a `RegistryError` of
   kind `ambiguous`.
4. **Missing** — if no match, return `{ found: false, reason: 'missing-target' }`
   and record a `RegistryError` of kind `missing-target`.

## Cache and Invalidation Semantics

| Aspect | Behaviour |
|---|---|
| **Granularity** | Per-file mtime check on each `scan()` call |
| **Population** | Eager on `scan()`; incremental when `invalidate()` is called |
| **Scope** | Process-local (one registry instance per remark processor run) |
| **Shared usage** | Single registry instance passed via `vfile.data.registry` so all Track C plugins share it without repeated I/O |
| **TTL** | No wall-clock TTL; purely mtime-driven. Safe for watch mode. |

Invalidation flow:

```
scan(roots)
  → for each file:
      if cached mtime === current mtime → reuse entry
      else → re-parse and update entry
  → rebuild duplicate and cycle indexes
```

## Error Reporting Expectations

Each registry error is surfaced as a remark-lint `VFile` message with:

```
code:     "tiab:registry:<kind>"
severity: configurable (default: "error" for missing-target/duplicate-id, "warn" for ambiguous/cycle)
position: line/column of the link or frontmatter field that triggered the check
message:  human-readable description (see examples below)
```

Example messages:

| Kind | Template |
|---|---|
| `missing-target` | `Cross-reference target not found: "[[missing.md]]"` |
| `duplicate-id` | `Duplicate id "wi-100" in: backlog/100.md, backlog/101.md` |
| `cycle` | `Reference cycle detected: backlog/a.md → backlog/b.md → backlog/a.md` |
| `ambiguous` | `Ambiguous reference "shared-name" matches: backlog/shared-name.md, docs/shared-name.md` |

## Integration Points for Epic 170 Track C

The following plugins depend on `ProjectRegistry` being pre-populated before the
remark transformer phase runs. The recommended integration pattern is a
`project-context` pre-scan plugin at Layer 3 (see architecture doc) that attaches
the registry to `vfile.data`:

| Plugin | Registry API used |
|---|---|
| `remark-lint-crossref` (extended) | `lookup(ref)`, `hasAnchor(file, anchor)` |
| `remark-lint-naming-conventions` (extended) | `lookup(ref)` for parent-child checks |
| `remark-lint-backlog-semantic` (new) | `findDuplicates()`, `detectCycles()`, `errors()` |
| `remark-lint-lifecycle-rules` (new) | `lookup(ref)` for cross-item lifecycle checks |

Pre-scan plugin sketch:

```typescript
// lib/plugins/remark-project-context.ts
import type { Plugin } from 'unified';
import type { ProjectRegistry } from '../registry/types.js';

interface Options { registry: ProjectRegistry; roots?: string[] }

const remarkProjectContext: Plugin<[Options]> = ({ registry, roots = ['.'] }) =>
  async (_tree, file) => {
    await registry.scan(roots);
    file.data.registry = registry;
  };

export default remarkProjectContext;
```

Track C plugins then read `file.data.registry` rather than performing their own
file system calls, making them fast and testable with in-memory fixture data.

## Fixture Coverage

The canonical fixture set lives at `tests/fixtures/registry/registry-cases.json`
and covers:

| Case name | What it validates |
|---|---|
| `basic-resolution` | Normal lookup: all refs resolve to known files |
| `missing-target` | Unresolved `[[wikilink]]` ref → `missing-target` error |
| `duplicate-id` | Two files with the same `id` → `duplicate-id` error |
| `ambiguous-basename` | Same basename in two directories → `ambiguous` error |
| `cycle-detection` | A → B → A reference cycle → `cycle` error |

Each case specifies `nodes[]` (input graph) and `expected` (error counts) so that
registry implementation tests can be data-driven and independent of the file
system.
