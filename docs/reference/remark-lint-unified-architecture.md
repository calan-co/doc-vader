---
id: remark-lint-unified-architecture
title: Remark-lint Unified Architecture (Doc-Vader)
type: document
subtype: reference
docType: reference
created: "2025-11-16"
status: proposed
lifecycle: draft
priority: high
tags:
  - reference
  - architecture
  - linting
  - remark
links:
  - decision: "[[../architecture/decisions/adr-001-remark-lint-unified-adoption.md]]"
---

## Overview

This document defines the target architecture for consolidating all documentation linting and validation into a single unified pipeline built on unified/remark-lint. The design separates concerns into ordered layers, uses a shared project context for cross-file checks, and standardizes rule configuration and message format.

## Architecture Layers

```mermaid
flowchart LR
  A[Layer 0\nParse & Frontmatter] --> B[Layer 1\nSchema & Metadata]
  B --> C[Layer 2\nTemplate & Diátaxis]
  C --> D[Layer 3\nProject Context Registry]
  D --> E[Layer 3 Rules\nCrossref, Naming, Backlog, Lifecycle]
  E --> F[Layer 4\nPolicies & Suggestions]

  subgraph L0 [Layer 0]
    A1(remark-parse) --> A2(remark-frontmatter)
  end

  subgraph L1 [Layer 1]
    B1(frontmatter-normalize) --> B2(frontmatter-schema\nAjv + cache)
    B2 --> B3(metadata-enums)
    B3 --> B4(lifecycle-rules)
  end

  subgraph L2 [Layer 2]
    C1(template-compliance) --> C2(diataxis-classifier)
    C2 --> C3(checklist)
  end

  subgraph L3 [Layer 3]
    D1(project-context preload)
  end
```

## Plugin Inventory and Mapping

| Layer | Plugin/Rule                      | Status   | Notes                                  |
| ----- | -------------------------------- | -------- | -------------------------------------- |
| 0     | remark-parse, remark-frontmatter | existing | Parse Markdown + YAML frontmatter      |
| 1     | frontmatter-normalize            | new      | Normalize IDs/dates into vFile.data    |
| 1     | frontmatter-schema (Ajv)         | migrate  | Port Ajv script into plugin with cache |
| 1     | metadata-enums                   | new      | Validate enums per schema              |
| 1     | lifecycle-rules                  | new      | Enforce lifecycle/status transitions   |
| 2     | template-compliance              | extend   | Multi-template support by subtype      |
| 2     | diataxis-classifier              | new      | Validate folder placement vs subtype   |
| 2     | checklist                        | existing | Ensure required checklist items        |
| 3     | project-context                  | new      | Pre-scan registry: files, anchors, ids |
| 3     | crossref                         | extend   | Use registry; validate anchors & files |
| 3     | naming-conventions               | new      | Filename and slug patterns             |
| 3     | backlog-semantic                 | new      | Epic/feature/story/task links & deps   |
| 3     | lifecycle-rules (uses context)   | new      | Cross-item lifecycle integrity         |
| 4     | link-external-policy             | new      | Allow/deny list for external links     |
| 4     | dependency-graph                 | new      | Detect cycles; warn on large fan-in    |
| 4     | auto-fix-suggestions             | new      | Provide non-mutating suggestions       |

## Processor Contract

- Input: Markdown file contents with YAML frontmatter.
- Output: remark vfile messages with standardized metadata:
  - code: `tiab:<domain>:<rule>`
  - severity: error|warn|info (configurable)
  - docsUrl: link to rule docs
- Shared context: Ajv instance, schema cache, project registry.

## Configuration Strategy

- `.remarkrc.mts` defines the canonical pipeline order and rule options.
- `createTiabProcessor({ mode, overrides })` factory for programmatic use.
- `tiab-lint.config.mjs` (optional) to externalize rule tuning (e.g., required checklist items, severity mapping).
- Environment flags: `TIAB_LINT_MODE=perf|full`, `STRICT_FRONTMATTER=1|0`.

## Closure and Guardrail Layers

- Backlog closure model is enforced by schema compatibility:
  - `status: closed` supported across lifecycle transitions.
  - `status_reason` required for closed work-items.
- Guardrail lane for backlog hygiene is executed with deterministic CLI gates:
  - `doc-vader backlog validate --fail-on error|warning`
  - `doc-vader backlog validate --format json`
  - `doc-vader backlog validate --profile <name|path>`
  - `doc-vader backlog validate --schema-map <path>`
- CI should run warning-level failure policy to block merge on unresolved hygiene drift.

## Data Flow

```mermaid
sequenceDiagram
  participant CLI as CLI/CI
  participant RP as remark Processor
  participant SC as Schema Cache
  participant PR as Project Registry

  CLI->>RP: process(file)
  RP->>SC: load(schema) [mtime-check]
  RP->>RP: L1 normalize/schema/metadata
  RP->>PR: read registry (anchors, ids, links)
  RP->>RP: L2 template/diataxis/checklist
  RP->>RP: L3 crossref/naming/backlog/lifecycle
  RP->>RP: L4 policies/suggestions
  RP-->>CLI: messages (JSON/text)
```

## Success Criteria

- Single-command lint with consistent output across all rules.
- Parity with legacy scripts or intentional, documented deltas.
- Full-lint time within target bounds; perf mode for local iterations.

## References

- Decision: [[../architecture/decisions/adr-001-remark-lint-unified-adoption.md]]
- [Unified/remark](https://unifiedjs.com/) - on [GitHub](https://github.com/remarkjs/remark-lint)
