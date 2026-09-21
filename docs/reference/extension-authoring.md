---
$schema: /frontmatter/document
id: refextauthor-60440
title: Extension Authoring
type: document
subtype: reference
lifecycle: active
status: ready
tags:
  - extensibility
  - extensions
  - document-packs
links:
  reference:
    - '[[document-type-packs.md]]'
    - '[[../architecture/decisions/adr-011-document-pack-routing-and-config.md]]'
---

# Extension Authoring

A Doc-Vader extension is the planned Node-package integration shape for commands
and package behavior in the `dv` command surface. A document type pack may be
distributed as an extension when it needs commands, generators, checks, or
handlers in addition to schemas and templates. The current CLI does not yet load
extensions.

## Package Shape

```text
extensions/dv-example-decisions/
  package.json
  index.mjs
  schemas/
  templates/
  README.md
```

`package.json` declares the extension entrypoint:

```json
{
  "name": "@example/dv-decisions",
  "type": "module",
  "main": "index.mjs",
  "docVader": {
    "extension": "./index.mjs"
  }
}
```

A future extension host may support `register`, `registerDocVaderExtension`, or
a default registration function:

```js
export function registerDocVaderExtension(program, context) {
  program
    .command("decisions")
    .description("Example decision document commands")
    .command("init")
    .action(() => {
      // Write templates, dv.yaml defaults, or examples.
    });
}
```

The planned extension context includes the current working directory:

```js
export function register(program, { cwd }) {
  // cwd is the workspace where dv is running.
}
```

## Planned Installation Manifest

The current CLI has no `dv extensions` command and does not read an extension
manifest. Do not rely on installation or activation behavior in this release.
The proposed manifest shape for a future extension host is:

```json
{
  "schemaVersion": "doc-vader/extensions/v1",
  "extensions": [
    {
      "name": "@example/dv-decisions",
      "packageName": "@example/dv-decisions",
      "packageSpecifier": "./extensions/dv-example-decisions",
      "entrypoint": "./index.mjs",
      "enabled": true,
      "installedAt": "2026-07-10T00:00:00.000Z"
    }
  ]
}
```

## Document-Pack Responsibilities

When an extension ships a document type pack, include:

- a document-type-pack manifest matching
  `schemas/doc-vader/document-type-pack.json`
- metadata schemas composed from `schemas/metadata/base.json`
- content schemas when body structure is governed
- templates that emit `namespace`, `type`, optional `subtype`, `$schema`, and
  `$content_schema` when applicable
- `dv.yaml` examples for directory-local namespace/type inference
- command docs that state whether commands mutate files or only read metadata

## Routing Responsibilities

Extensions should register behavior by route, not by file path:

```text
example.decisions:decision:adr
example.decisions:decision
example.decisions:*
```

Avoid assuming Markdown frontmatter. If a command only supports Markdown, say so
as a format limitation and consume canonical metadata after the Markdown format
adapter has parsed it.

## Configuration Responsibilities

The intended `dv.yaml` shape for workspace and nested document-root defaults is:

```yaml
namespace: example.decisions
defaultType: decision
```

When runtime discovery is implemented, nested configs will merge from repository
root to document directory. Closer values override parent values. Scalars replace,
objects merge, and arrays replace unless a future package contract defines a more
specific merge strategy.

Legacy `.doc-vader/backlog-consumer.json` and `.doc.json` remain the supported
runtime inputs. New extensions and packs must not require `dv.yaml` until its
runtime discovery is implemented.

## Safety Checklist

- [ ] Do not claim `dv extensions` installation or manifest activation support.
- [ ] Keep commands scoped under a package-specific command family.
- [ ] Declare whether each command is read-only or mutating.
- [ ] Route by `namespace:type[:subtype]`.
- [ ] Treat `frontmatter` as Markdown adapter terminology only.
- [ ] Provide deterministic JSON output for automation-facing commands.
