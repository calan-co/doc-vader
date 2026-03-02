---
title: Contributing Guide
id: contributing-guide
type: document
subtype: rules
lifecycle: active
status: approved
---

## Documentation & Editing Standards (Critical Update)

### File Reload and State Consistency

- **Always read the latest file state from disk before making or reporting on changes.**
- Use event-driven or explicit reload triggers (e.g., "RELOAD FILE" keyword, file change event, or cache invalidation) to ensure you are working with the most current version.
- For protected/system files, prompt for access if needed.

### Frontmatter & Structure Validation

- **Validate all frontmatter and structure before and after edits** using the schema-driven linter:
  - Run `npm run docs:lint` before and after every change to documentation or work items.
  - Reference the appropriate schema and template for the file type (see `docs/templates/` and `schemas/`).
- For backlog-affecting changes, run hygiene validation:
  - `doc-vader backlog validate --dir backlog --fail-on error`
  - CI-grade policy: `npm run backlog:validate:ci` (writes `backlog/audit/auditing-backlog-report.json`)

### YAML Formatting Rules

- Fence `---` on line 1 for YAML frontmatter
- 2-space indentation (no tabs)
- No duplicate fields
- All required fields present per schema/template
- Proper enums and field types

### Edit/Refactor Checklist (MANDATORY)

For every documentation or work item edit/refactor, contributors and LLMs **must**:

- [ ] Explicitly reload the file from disk before editing (or on trigger)
- [ ] Validate frontmatter and structure using `npm run docs:lint` (before and after)
- [ ] Reference the schema and template for required fields and structure
- [ ] Enforce YAML formatting rules (see above)
- [ ] Use a checklist for every change, referencing the schema and validation tool
- [ ] For protected/system files, prompt for access if needed

### Training & Onboarding

- All contributors and LLMs must be trained to follow the above checklist for every change.
- Review onboarding and instruction sets regularly to ensure compliance with these standards.

## Contributing Guide

Thank you for your interest in Team-in-a-Box!

## Documentation Standards

### Lifecycle and Status Usage Guidance

When updating a work item's state, always check that the new `status` is valid for its current `lifecycle`.
Use the reference [[lifecycle-status-rules#State Dependency Rules|table]] and [[lifecycle-status-examples#Example State Transitions|diagram]] for documentation, templates, and automation.

### Structure

Documentation is organized into focused areas:

- **`docs/`** - Top-level documentation hub with README navigation
- **`docs/explanation/`** -
- **`docs/how-to/`** -
- **`docs/tutorial/`** -
- **`docs/reference/`** -

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
- Follow code style guidelines (see [[coding-standards]]).
- Submit pull requests with clear descriptions.
- Write tests for new features.
- Ensure your code passes all tests before submitting.

## Pull Request Checklist

- [ ] Code follows style guidelines
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No secrets or sensitive data committed
- [ ] All CI checks pass
- [ ] Backlog hygiene gate passes (`npm run backlog:validate:ci`)

## Reporting Issues

- Use GitHub Issues for bugs and feature requests.
  NOTE: Include steps to reproduce and expected behavior.

## Code of Conduct

- Be respectful and collaborative.
- See [[SUPPORT]] for help.
