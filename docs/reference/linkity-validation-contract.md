---
id: linkity-60508
title: Linkity Validation Contract
type: document
subtype: reference
lifecycle: draft
status: proposed
tags:
  - documentation
  - linkity
  - validation
links:
  related:
    - '[[../../backlog/60508-linkity-validation-contract.md]]'
---

## Purpose

Doc-Vader will use Linkity as the parser for documentation cross-reference
validation. This contract fixes the supported link formats and the migration
rules before the remark adapter and CI gate are implemented.

## Supported Linkity Inputs

Enable every Linkity parser Doc-Vader needs for Markdown documentation:

| Linkity type | Examples | Validation policy |
| --- | --- | --- |
| `wikilink` | `[[target]]`, `[[target#section]]`, `[[target\|label]]` | Resolve as Doc-Vader cross-references. Validate file/id targets and fragments after normalizing the target path. |
| `markdown` | `[label](target.md)`, `[label](target.md#section)`, `[label](../guide/file.md)` | Resolve relative to the source document. Validate files and fragments. |
| `url` | `https://example.com`, `http://example.com/path` | Treat as external. Syntax is in scope; network reachability is out of scope. |
| `custom` | `mailto:team@example.com`, `vscode://file/path`, `obsidian://open?vault=docs` | Treat as external unless a Doc-Vader resolver explicitly owns the scheme. |

Linkity also reports aliases and character offsets. Doc-Vader must preserve them
in lint messages so remediation points at the source link, not only the resolved
target.

## Normalization Rules

- Decode percent-encoded path and fragment text before lookup.
- Normalize `.` and `..` segments against the source document directory.
- Compare fragments with the same slug algorithm used by the documentation
  heading index.
- Ignore links in fenced code blocks and inline code unless a later task adds an
  explicit code-sample validation mode.
- Do not rewrite Linkity's parsed `value`; store normalized lookup keys beside
  the raw source value.

## Templates, Generated, and Ignored Targets

Documentation templates under `templates/` and `docs/**/templates/` are in scope
for syntax parsing. Template placeholders inside link targets are not resolved;
report them as `template-target` so template authors can decide whether the
placeholder is intentional.

Generated files are not link failures when they are declared in the documentation
build inventory. The adapter must report them as `generated-target` so the CI gate
can distinguish them from missing files.

Ignored paths remain out of scope when they match the existing docs lint ignore
configuration. A link from an in-scope document to an ignored target must report
`ignored-target`, not `missing-target`.

## Remark Crossref Mapping

| Current `remark-lint-crossref` behavior | Linkity behavior |
| --- | --- |
| Validates wikilinks and Markdown links with repository-specific lookup logic. | Linkity parses `wikilink` and `markdown`; Doc-Vader owns resolution and diagnostics. |
| Treats HTTP(S) URLs as external and does not fetch them. | Keep that behavior for Linkity `url`. |
| Reports broken path and fragment lookups as remark lint messages. | Keep message severity and source positions, using Linkity offsets. |
| Ignores generated or configured out-of-scope files via the existing lint pipeline. | Preserve the same ignore inputs and surface `generated-target` / `ignored-target` diagnostics. |
| Does not intentionally validate custom URI schemes. | Accept Linkity `custom` links as external unless a resolver for the scheme is configured. |

Intentional difference: Linkity is the only parser for supported link syntax.
Doc-Vader code should stop maintaining separate regular expressions for the same
formats once the adapter lands.

## Migration Plan

1. Add a Linkity adapter that converts Linkity nodes into Doc-Vader lookup
   requests and diagnostics.
2. Add fixtures covering `wikilink`, `markdown`, `url`, `custom`, fragments,
   encoded paths, generated targets, ignored targets, and code spans.
3. Wire the adapter into every lint-pipeline integration point in warning-only
   mode:
   - `.remarkrc.mts` for the remark plugin list.
   - `scripts/docs-remark-lint.ts` for CLI loading and reporting.
   - `staging/scripts/docs-lint.sh` for the local documentation lint wrapper.
   - `lib/processor.ts` for shared processor execution used by programmatic
     callers.
   - `package.json` / `project.json` targets that expose `docs:lint` locally and
     in Nx.
   - `.github/workflows/` documentation validation jobs that call the same gate.
4. Repair documentation links reported by Linkity while preserving intentional
   generated and ignored targets.
5. Promote the Linkity gate to the required local and hosted CI documentation
   validation path.

## Enforced Gate

Run the enforced migrated-scope gate locally with:

```bash
pnpm run docs:lint:linkity
```

The gate covers `docs/reference/**/*.md` and `docs/how-to/**/*.md`, matching hosted CI. It fails on Linkity `missing-target` and `missing-anchor` diagnostics. External URLs, custom schemes, generated non-Markdown artifacts, and template placeholders remain warning-only or out of scope.

Escape hatch: do not add fake placeholder files. Either correct the target, remove the link, move legacy references to their real archive path, or leave an intentional template/generated reference so Linkity classifies it outside the enforced broken-link set.
