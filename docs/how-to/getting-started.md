---
title: Getting Started
id: gettings-3190
type: document
subtype: generic
lifecycle: active
status: ready
---

## Getting Started with doc-vader

This guide walks you through installing `doc-vader` and running your first validation.

### Prerequisites

- Node.js ≥ 22
- A Markdown-based project with a `docs/` or `backlog/` directory

### 1. Install

```bash
npm install -g @calan-co/doc-vader
```

To install from the GitHub Package Registry, add the following to your `.npmrc`:

```
@calan-co:registry=https://npm.pkg.github.com
```

### 2. Validate frontmatter

Run frontmatter validation against your docs directory:

```bash
doc-vader frontmatter validate docs/
```

### 3. Audit your backlog

If your project has a `backlog/` directory with work-item files:

```bash
doc-vader backlog validate --dir backlog --format text
```

To enforce CI-safe exit codes on errors:

```bash
doc-vader backlog validate --dir backlog --profile ci --fail-on error
```

### 4. Validate all domains at once

```bash
doc-vader validate --docs-dir docs --schema-dir schemas
```

### 5. Using as a library

```typescript
import { frontmatter, backlog } from "@calan-co/doc-vader";

const fmResult = await frontmatter.lint({ docsDir: "docs" });
const report = await backlog.validate({ backlogDir: "backlog", failOn: "error" });
```

See the [README](../../README.md) for the full CLI reference and API details.

6. **Next Steps**

   - See [FAQ](./faq.md) for common questions
   - See [Troubleshooting](./troubleshooting.md) for help
   - Explore [Example Files](../../examples/README.md)

```bash

```
