# AGENTS.md

## Repository Navigation

- ALWAYS prioritize instructions in `AGENTS.md` by proximity to the target files.
- For skills that delegate work, run in parallel, or split efforts across workspaces, compose `skills/aspects/sandboxing-workspace/SKILL.md`
- If a task references or edits `docs/rfcs/**`, MUST read `docs/rfcs/AGENTS.md` and `docs/rfcs/INTERACTION_PROTOCOL.md` before responding.
- Any optimization activity targeting any `AGENTS.md` file MUST use the `writing-agents-md` skill before proposing or applying edits.

## Safety Boundaries

**NEVER modify, disable, or bypass any explicitly applied constraint without explicit written approval in the current conversation turn.** This includes:

- GitHub branch protection rules or rulesets (e.g., `required_approving_review_count`, `require_last_push_approval`, bypass actors)
- Repository secrets or environment variable configurations
- Collaborator permissions or team access
- CI/CD workflow triggers or required status checks
- Local git hooks (pre-commit, pre-push, etc.)
- Local file permissions or access controls

If blocked by any such constraint, **stop and ask** — do not modify or work around it to proceed.

## Working with Documentation and Backlog Files

### State Consistency & File Freshness

**CRITICAL:** Always read the latest file state from disk before making or reporting on changes.

- Use explicit reload triggers (file-change events, "RELOAD FILE" keyword, or cache invalidation) to ensure you are working with the most current version.
- When editing or reporting on documentation or work items, verify freshness first.
- For protected/system files, prompt the human for access if needed.

### Frontmatter & Structure Validation

**MANDATORY:** Validate all frontmatter and structure before and after edits.

- Run `pnpm run docs:lint` before and after every change to documentation or work items.
- Reference the appropriate schema in `schemas/` and template in `docs/templates/` for the file type.
- For backlog-affecting changes, also run:
  - `doc-vader backlog validate --dir backlog --fail-on error`
  - CI-grade validation: `pnpm run backlog:validate:ci` (generates `backlog/audit/auditing-backlog-report.json`)

### YAML Formatting Rules

Enforce these rules for all YAML frontmatter:

- Fence `---` on line 1
- 2-space indentation (no tabs)
- No duplicate fields
- All required fields present per schema/template
- Proper enum values and field types

### Edit/Refactor Checklist

For every documentation or work-item edit, refactor, or migration:

- [ ] Explicitly reload the file from disk before editing (or on trigger)
- [ ] Validate frontmatter and structure using `pnpm run docs:lint` before and after
- [ ] Reference the schema and template for required fields and valid state transitions
- [ ] Enforce YAML formatting rules (see above)
- [ ] Run relevant validation gates (`docs:lint`, `backlog:validate`, etc.)
- [ ] For protected/system files, prompt for access if needed
- [ ] Confirm all findings against current code before applying fixes

### Minimal, Targeted Patches

When fixing issues:

- Prefer focused, minimal patches over bulk refactoring.
- Validate each reported finding against current code before applying a fix.
- Run focused test/validation immediately after each patch.
- Avoid half-implemented solutions or speculative changes.

