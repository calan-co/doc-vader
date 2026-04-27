---
title: Contributing Guide
id: contributing-guide
type: document
subtype: rules
lifecycle: active
status: approved
---

# Contributing to doc-vader

Thank you for your interest in contributing to `doc-vader`!

## Development Setup

### Prerequisites

- Node.js ≥ 22
- pnpm 8 (`npm install -g pnpm@8`)

### Clone and install

```bash
git clone https://github.com/calan-co/doc-vader.git
cd doc-vader
pnpm install
```

### Build

```bash
pnpm build
```

### Run tests

```bash
pnpm test
```

### Lint documentation

```bash
pnpm run docs:lint
```

### Validate backlog hygiene

```bash
pnpm run backlog:validate
```

## Documentation Standards

### Lifecycle and Status Usage Guidance

When updating a work item's state, always check that the new `status` is valid for its current `lifecycle`.
See the schemas in `schemas/` and templates in `docs/` for field constraints and valid state transitions.

### Structure

Documentation is organized into focused areas:

- **`docs/`** - Top-level documentation hub
- **`docs/explanation/`** - Conceptual background and architecture docs
- **`docs/how-to/`** - Task-focused guides and getting-started content
- **`docs/reference/`** - API and schema reference

### Naming Conventions

- **General Rule:** All documentation files use **kebab-case** (e.g., `project-brief.md`)
- **Special Files:** README.md, CONTRIBUTING.md, LICENSE.md, CHANGELOG.md (uppercase)
- **Stories:** `{epic}.{story}.story.md` (e.g., `4.6.story.md`)
- **ADRs:** `adr-###-kebab-case.md` (lowercase "adr", e.g., `adr-001-file-system-persistence.md`)
- **QA Gates:** `{epic}.{story}-{slug}.yml` (e.g., `4.6-system-utility-service.yml`)
- **QA Approvals:** `{epic}.{story}-approval-summary.md` (e.g., `4.6-approval-summary.md`)

### Content Requirements

- **Diagrams:** Use Mermaid syntax for all diagrams. Do not use ASCII art.
- **Cross-References:** All internal links must resolve to existing files and anchors.
- **Frontmatter:** Every documentation file must include YAML frontmatter:
  - Required: `id`, `title`, `type`, `subtype`, `lifecycle`, `status`
  - Recommended: `tags`, `links`, `owner`, `summary`, `audience`
  - Governance (optional but encouraged when applicable):
    - `governanceProfiles`: array of strings or objects `{ name, category, version?, mode? }`
    - `reconciliation`: `prompt | auto | split | prioritize` for resolving profile conflicts
- **Templates:** Follow established templates for all documented types. Recommend specific modifications if updates or additions are needed.
- **No Date Suffixes:** Use git history for versioning, not date suffixes in filenames.

### Governance Profiles

- Use `governanceProfiles` to declare applicable documentation systems and/or process models (e.g., `diataxis`, `tgdpr`, `sdlc`).
- Prefer typed objects when specifying non-default behavior:

  ```yaml
  governanceProfiles:
    - name: diataxis
      category: documentation
    - name: sdlc
      category: process
      mode: strict
  reconciliation: prompt
  ```

- When multiple profiles impose conflicting rules, set `reconciliation` and run CLI reconciliation in dry-run mode first.

## How to Contribute

- Fork the repo and create a feature branch.
- Follow code style guidelines (see [docs/reference/coding-standards.md](docs/reference/coding-standards.md)).
- Submit pull requests with clear descriptions.
- Write tests for new features.
- Ensure your code passes all tests before submitting.

## Pull Request Checklist

- [ ] Code follows style guidelines
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No secrets or sensitive data committed
- [ ] All CI checks pass
- [ ] Backlog hygiene gate passes (`pnpm run backlog:validate:ci`)

## Reporting Issues

- Use GitHub Issues for bugs and feature requests.
  NOTE: Include steps to reproduce and expected behavior.

## Code of Conduct

- Be respectful and collaborative.
- See [docs/how-to/support.md](docs/how-to/support.md) for help.
