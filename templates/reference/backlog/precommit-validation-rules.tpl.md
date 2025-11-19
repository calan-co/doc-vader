<!-- generate-frontmatter: document subtype=precommit-validation-rules -->

# Pre-commit Validation Rules Reference

This document is auto-generated. It combines all pre-commit validation rules extracted from the relevant scripts and the canonical schema.

## Rules

{{RULES}}

## Enforcement

Validation is performed automatically on pre-commit using CI and local hooks. Only files changed in the triggering commit are validated by default, but the validation and linting tools can be run against the entire project or a specified list of files/directories. Commits failing validation are rejected until all rules are satisfied.

## Source Scripts

{{SCRIPTS}}

> **NOTICE TO CONTRIBUTORS:**
>
> All pre-commit validation rules, required fields, and enforcement logic are now generated directly from the canonical JSON schema:
>
> - [schemas/frontmatter/document/latest.json](../../schemas/frontmatter/document/latest.json)
> - [schemas/work-item.latest.frontmatter.schema.json](../../schemas/work-item.latest.frontmatter.schema.json)
>
> **Do not duplicate rules in prose.**
>
> - To update a rule, field, or template, edit the schema only.
> - All validation scripts and templates are auto-generated from the schema.
> - Run `npm run docs:generate-templates` to regenerate templates and docs.
> - See schema descriptions for both human- and machine-readable guidance.
>
> **Source of truth:** The schema files above.
> **How to update:** Edit the schema, then regenerate.
> **How to validate:** Run `npm run docs:lint` and `npm run docs:generate-templates`.

For all field requirements, enums, and validation rules, see the schema files directly.
