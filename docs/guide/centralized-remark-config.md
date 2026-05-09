---
id: centrali-2145
title: Centralized Remark Configuration and Core Pipeline
type: document
subtype: guide
lifecycle: active
status: ready
---

This feature provides a single source of truth for remark linting rules and options, with standardized plugin exports and zod-validated schemas. As of item 171 completion, all document validation is unified through a single remark-lint pipeline, replacing individual tools like markdownlint-cli2, naming-conventions-lint, etc.

## Overview

The unified remark-lint pipeline validates documentation through multiple layers of plugins:

- **Layer 2 (Content Compliance)**:
  - `remark-lint-checklist`: Ensures required checklist items are present
  - `remark-lint-template-compliance`: Validates heading structure and template requirements
  - `remark-lint-no-ascii-diagrams`: Warns against ASCII art (use proper diagramming tools instead)
  - `remark-lint-no-html-anchors`: Prevents raw HTML anchor tags (use markdown heading IDs instead)

- **Layer 3 (Cross-reference & Naming)**:
  - `remark-lint-crossref`: Validates all cross-references resolve to existing files and anchors
  - `remark-lint-naming-conventions`: Enforces file naming standards (kebab-case, backlog patterns, ADR format, etc.)

## Usage

### 1. Configuration

The canonical remark pipeline is defined in `.remarkrc.mts`:

```js
import remarkLintChecklist from "./lib/plugins/remark-lint-checklist.js";
import remarkLintCrossref from "./lib/plugins/remark-lint-crossref.js";
import remarkLintTemplateCompliance from "./lib/plugins/remark-lint-template-compliance.js";
import remarkLintNamingConventions from "./lib/plugins/remark-lint-naming-conventions.js";
import remarkLintNoAsciiDiagrams from "./lib/plugins/remark-lint-no-ascii-diagrams.js";
import remarkLintNoHtmlAnchors from "./lib/plugins/remark-lint-no-html-anchors.js";

export default {
  plugins: [
    // Layer 2: Content compliance
    [
      remarkLintChecklist,
      {
        /* options */
      },
    ],
    [
      remarkLintTemplateCompliance,
      {
        /* options */
      },
    ],
    [
      remarkLintNoAsciiDiagrams,
      {
        /* options */
      },
    ],
    [
      remarkLintNoHtmlAnchors,
      {
        /* options */
      },
    ],
    // Layer 3: Cross-reference and naming validation
    [remarkLintCrossref, { rootDir: process.cwd() }],
    [
      remarkLintNamingConventions,
      {
        /* options */
      },
    ],
  ],
};
```

### 2. Validation Commands

Run documentation validation with:

```bash
# Run unified validation on all docs
pnpm run docs:lint

# Run validation on specific files
pnpm run docs:lint docs/my-file.md backlog/

# Validate backlog work items
pnpm run backlog:validate
```

The `docs:lint` target uses `scripts/docs-remark-lint.ts`, which loads all plugins and validates against provided file patterns.

### 3. Programmatic API

Use the processor factory in scripts/tests:

```ts
import { createTiabProcessor } from "./lib/processor";

const processor = createTiabProcessor({
  checklist: { enabled: true, requiredItems: ["Task 1", "Task 2"] },
  crossref: { enabled: true },
  templateCompliance: {
    enabled: true,
    requiredHeadings: ["Introduction", "Conclusion"],
  },
  namingConventions: { enabled: true },
  noAsciiDiagrams: { enabled: true },
  noHtmlAnchors: { enabled: true },
});
```

### 4. Plugin Option Validation

All plugins use zod schemas for options validation. Invalid options will throw errors during processing with descriptive messages.

### 5. Testing

Unit tests are provided for each plugin in `lib/plugins/tests/*.test.ts`:

```bash
pnpm test -- lib/plugins/tests/remark-lint-naming-conventions.test.ts
pnpm test -- lib/plugins/tests/remark-lint-no-ascii-diagrams.test.ts
pnpm test -- lib/plugins/tests/remark-lint-no-html-anchors.test.ts
```

Integration tests validate the entire pipeline in `lib/integration/remark-pipeline.integration.test.ts`.

## Migration from Legacy Linters

As of item 171 completion, the following tools have been consolidated into the unified remark pipeline:

| Legacy Tool                   | Replaced By                                       | Status      |
| ----------------------------- | ------------------------------------------------- | ----------- |
| `markdownlint-cli2`           | `remark-preset-lint-*` (pending) + built-in rules | ✅ Migrated |
| `naming-conventions-lint.cjs` | `remark-lint-naming-conventions`                  | ✅ Migrated |
| `diagram-lint.cjs`            | `remark-lint-no-ascii-diagrams`                   | ✅ Migrated |
| `anchor-lint.cjs`             | `remark-lint-no-html-anchors`                     | ✅ Migrated |
| `crossref-lint.cjs`           | `remark-lint-crossref`                            | ✅ Migrated |
| `frontmatter-lint.cjs`        | Pending integration (item 172)                    | ⏳ Deferred |

To run all validations via the unified pipeline:

```bash
# Old approach (no longer recommended)
# pnpm run docs:lint  # Runs individual linters

# New approach (unified)
pnpm run docs:lint
```

## Naming Conventions

The `remark-lint-naming-conventions` plugin enforces:

- **General files**: kebab-case (e.g., `my-document.md`)
- **Special files**: UPPERCASE names (README.md, CONTRIBUTING.md, etc.)
- **Backlog items**: `{number}.{slug}-{type}.md` (e.g., `171.remark-config-feature.md`)
- **ADRs**: `adr-###-kebab-case.md` (e.g., `adr-001-remark-adoption.md`)

---

For more details, see:

- [Remark-lint unified architecture](../reference/remark-lint-unified-architecture.md)
- [CONTRIBUTING.md](../../CONTRIBUTING.md) for naming and style standards
- [Item 171 backlog](../../backlog/171.remark-config-and-core-pipeline-feature.md)
