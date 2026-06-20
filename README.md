# doc-vader

> Entity governance, documentation automation, validation, and workflow guardrails for structured repositories.

`doc-vader` is a CLI and library for applying governance rules to extensible repository entities. It validates frontmatter schemas, audits backlog metadata, applies governance profiles (Diataxis, TGDP, SDLC), automates work-item lifecycle transitions, and is evolving toward a runtime with explicit storage and format adapter seams.

## Features

- **Frontmatter validation** — schema-driven linting with configurable strictness
- **Backlog hygiene** — audit, validate, and enforce closure semantics on work-item files
- **Diataxis/TGDP governance** — classify and align docs with documentation-framework rules
- **Work-item lifecycle** — transition, link, record commits, and finalize work items via CLI
- **CI-safe gates** — deterministic exit codes via `--fail-on` and `--profile` flags
- **Programmatic API** — fully typed TypeScript exports for embedding in toolchains

## Requirements

- Node.js ≥ 22
- pnpm 8 (or npm/yarn for consuming packages)

## Installation

### As a CLI (global)

```bash
npm install -g @calan-co/doc-vader
```

### In a project

```bash
npm install @calan-co/doc-vader
# or
pnpm add @calan-co/doc-vader
```

The package is published to the GitHub Package Registry. To install from it, add to your `.npmrc`:

```
@calan-co:registry=https://npm.pkg.github.com
```

### From source

```bash
git clone https://github.com/calan-co/doc-vader.git
cd doc-vader
pnpm install # --frozen-lockfile
pnpm build
pnpm link --global # or npm link --global
```

## Quick Start

Validate all frontmatter in your `docs/` directory:

```bash
doc-vader frontmatter validate docs/
```

Audit your `backlog/` directory with strict CI settings:

```bash
doc-vader backlog validate \
  --dir backlog \
  --profile ci \
  --fail-on error \
  --format json
```

Transition a work item to `in-progress`:

```bash
doc-vader work-item transition \
  --id WI-42 \
  --status in-progress \
  --assignee alice
```

## CLI Reference

Run `doc-vader --help` or `doc-vader <command> --help` for full option listings.

### `frontmatter`

| Subcommand        | Description                                     |
| ----------------- | ----------------------------------------------- |
| `validate [path]` | Validate frontmatter in documentation files     |
| `fix`             | Auto-fix frontmatter issues                     |
| `utils -i <file>` | Parse and inspect frontmatter for a single file |

Options for `validate`:

- `--no-strict` — allow files with missing frontmatter

### `doc-system`

| Subcommand                              | Description                             |
| --------------------------------------- | --------------------------------------- |
| `validate`                              | Validate docs for structure and content |
| `diataxis-validate -f <file> -t <type>` | Validate a file against a Diataxis type |
| `diataxis-fix [path]`                   | Auto-fix docs to align with Diataxis    |

Options for `diataxis-fix` / `validate`:

- `--dry-run` — show changes without writing
- `-d, --docs-dir <path>` — path to docs directory (default: `docs`)
- `-s, --schema-dir <path>` — path to schemas directory (default: `schemas`)

### `backlog`

| Subcommand     | Description                                                     |
| -------------- | --------------------------------------------------------------- |
| `validate`     | Audit and validate backlog work items                           |
| `list`         | List backlog items, optionally filtered by subtype              |
| `migrate`      | Migrate a legacy backlog to canonical work-management artifacts |
| `ingest-event` | Ingest a VCS/forge event payload and apply backlog mutations    |

Key options for `validate`:

- `-d, --dir <path>` — backlog directory (default: `backlog`)
- `--format text\|json` — output format
- `--fail-on error\|warning` — exit with non-zero on threshold
- `--profile default\|strict\|ci\|<path>` — validation profile
- `--include-archive` — include archived items

### `work-item`

| Subcommand      | Description                                                     |
| --------------- | --------------------------------------------------------------- |
| `transition`    | Transition a work item to a new lifecycle status                |
| `link <kind>`   | Attach a link (`pr`, `evidence`, or `reference`) to a work item |
| `record-commit` | Record an implementation commit SHA against a work item         |
| `finalize`      | Archive a work item with closure evidence                       |

All subcommands support `--dry-run` and `--consumer-config <path>`.

Example — finalize a work item:

```bash
doc-vader work-item finalize \
  --id WI-42 \
  --reason completed \
  --completed-date 2026-04-27 \
  --actual 8
```

### `record`

| Subcommand | Description                                                |
| ---------- | ---------------------------------------------------------- |
| `create`   | Create an append-only record artifact (e.g., test results) |

### `governance`

| Subcommand               | Description                                            |
| ------------------------ | ------------------------------------------------------ |
| `list`                   | List all available governance profiles                 |
| `detect <path>`          | Detect which profiles apply to a file or directory     |
| `effective-rules <file>` | Show merged, effective rules for a file                |
| `reconcile <file>`       | Reconcile conflicting profile rules                    |
| `migrate`                | Migrate legacy `governanceProfiles` frontmatter fields |

### `validate` (aggregate)

Runs frontmatter, doc-system, and backlog validation in one pass:

```bash
doc-vader validate --docs-dir docs --schema-dir schemas
```

## Programmatic API

`doc-vader` exports its core modules for use in TypeScript/JavaScript projects:

```typescript
import {
  frontmatter,
  docs,
  backlog,
  workManagement,
  diataxis,
} from "@calan-co/doc-vader";

// Validate frontmatter
const result = await frontmatter.lint({ docsDir: "docs" });

// Audit backlog
const report = await backlog.validate({
  backlogDir: "backlog",
  failOn: "error",
});
```

See the [reference documentation](docs/reference/) for full API details.

## Configuration

### Consumer config

Pass `--consumer-config <path>` to any `work-item`, `backlog`, or `record` command to provide a JSON configuration file that overrides default path resolution and schema routing.

Local pre-push validation also reads `.doc-vader/backlog-consumer.json`.

Example:

```json
{
  "automation": {
    "prePushValidation": {
      "schemas": {
        "baseline": "schemas/frontmatter/work-item/1.0.0.json",
        "changed": "schemas/frontmatter/by-type/work-item/latest.json",
        "archive": "schemas/frontmatter/work-item/1.0.0.json"
      },
      "severity": {
        "baseline": "error",
        "changed": "error",
        "archive": "warn",
        "checklist": "error"
      }
    }
  }
}
```

Severity values are `none|info|warn|error`.

Pre-push schema settings support local paths, `/frontmatter/...` aliases, `file://` URIs, and `https://` URLs.

Run manually:

```bash
pnpm run hooks:pre-push
```

Configuration precedence is:

1. Environment variables
2. `.doc-vader/backlog-consumer.json`
3. Built-in defaults

### Profiles

Validation profiles control which rules and severity levels are applied:

| Profile   | Description                                         |
| --------- | --------------------------------------------------- |
| `default` | Standard validation rules                           |
| `strict`  | All rules enforced                                  |
| `ci`      | CI-safe: machine-readable output, fail on any error |

You can also pass a path to a custom JSON profile file.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and pull request guidelines.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

## License

ISC — see [LICENSE](LICENSE) for details.
