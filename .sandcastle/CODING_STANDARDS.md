# Coding Standards

These standards guide Sandcastle planner, implementer, and reviewer agents for
doc-vader work. If repository-local instructions, schemas, or tests are more
specific than this file, follow the more specific source. If existing docs are
stale or inconsistent, prefer the current codebase, validation tooling, and
TypeScript/Node best practices.

## Planning

- Plan against the current repository state, not assumptions from old issues or
  generated logs. Reload relevant files before drawing dependency or conflict
  conclusions.
- Treat `AGENTS.md` files as binding operational constraints. The closest
  applicable `AGENTS.md` wins.
- Scope each Sandcastle implementation to one claimed task. Do not include
  opportunistic refactors, unrelated cleanup, or drive-by documentation edits.
- Sequence work by concrete dependency, file overlap, or API ownership. Preserve
  task priority order when no concrete blocker exists.
- Prefer small vertical changes that include validation evidence over broad
  rewrites with weaker proof.

## TypeScript Style

- Use strict TypeScript and ECMAScript modules. Include `.js` extensions for
  relative runtime imports from TypeScript source.
- Prefer named exports for reusable library APIs. Keep default exports only when
  they match an established local convention, such as remark plugins.
- Keep public types explicit: exported functions, option objects, result shapes,
  and errors should have named interfaces or type aliases.
- Avoid `any` and broad casts. If a third-party API forces `unknown` data,
  validate or narrow it at the boundary with schema checks, type guards, or
  explicit `instanceof`/property checks.
- Use `async`/`await` for asynchronous control flow. Preserve error causes and
  surface actionable error codes/messages for CLI and automation paths.
- Use Node built-ins with the `node:` prefix and keep path handling portable.
  Normalize POSIX paths only where output formats require POSIX separators.
- Prefer clear, local helper functions over clever inline expressions. Avoid
  nested ternaries and dense boolean logic when an `if`, `switch`, or named
  predicate is easier to audit.
- Keep comments sparse and useful. Add comments for non-obvious domain rules,
  compatibility choices, or algorithmic tie-breakers; remove comments that only
  restate the code.

## Architecture

- Preserve the existing module boundaries:
  - `cli/` owns command wiring and process-facing behavior.
  - `lib/task/` owns canonical task models, claims, evidence, and transitions.
  - `lib/work-management/` owns work-item status, frontmatter, and workflow
    behavior.
  - `lib/backlog/` owns backlog scanning, providers, resolution, and reports.
  - `lib/plugins/` owns remark lint rules and document validation plugins.
  - `schemas/`, `templates/`, and `profiles/` are compatibility surfaces.
- Keep business rules in `lib/` and make CLI commands thin adapters over library
  functions.
- Use schema-driven validation for structured data. Do not duplicate schema
  rules with ad hoc string parsing when JSON Schema, Zod, TypeBox, or existing
  helpers are available.
- Preserve backward compatibility for documented CLI output, schema names,
  frontmatter fields, profiles, and templates unless the task explicitly calls
  for a breaking change.
- Fail closed for ambiguous task IDs, missing files, invalid state transitions,
  malformed frontmatter, expired claims, and unknown provider behavior.
  Failing closed means raising an error and stopping rather than guessing a
  default behavior or silently succeeding with unsafe assumptions.
- Keep filesystem writes deterministic: stable ordering, two-space JSON
  formatting where already used, trailing newline, and no timestamps unless the
  domain model requires one.

## Documentation And Work Items

- For Markdown or backlog edits, follow the repository instructions in
  `AGENTS.md`: reload from disk, validate before and after, and keep patches
  minimal.
- Frontmatter must start on line 1 with `---`, use two-space indentation, avoid
  duplicate fields, and satisfy the relevant schema/template.
- Use the schemas under `schemas/` and templates under `templates/` as the
  source of truth for required fields, enum values, and status transitions.
- Preserve wiki links, evidence links, and existing IDs unless the task
  explicitly requires migration.
- Do not mark work items closed, archived, or complete without required
  evidence and validation passing.
## Testing

- Use Vitest for unit and integration tests. Put tests near established test
  locations for the touched module, such as `tests/`, `lib/plugins/tests/`, or
  `scripts/tests/`.
- Prefer red-green-refactor for behavioral changes: write a focused failing
  test, implement the smallest fix, then refactor only if the test remains
  clear.
- Test public behavior and edge cases, not implementation trivia. Cover failure
  modes for parsers, claims, transitions, providers, and CLI exits.
- Use temporary directories, `memfs`, or fixtures for filesystem-heavy tests.
  Avoid mutating repository fixtures unless the task is explicitly about those
  fixtures.
- Keep assertions deterministic. Avoid real network calls, wall-clock
  dependence, and environment-specific paths unless injected or mocked.
- Add or update integration tests when behavior crosses module boundaries, CLI
  commands, schema validation, or work-item lifecycle contracts.

## Validation

- Run the narrowest meaningful validation after each code change, then the
  broader gate before committing.
- Inside Sandcastle, run longer validation through
  `scripts/sandcastle/run-with-heartbeat.sh` so logs continue to show progress.
- For code changes, normally run:
  - `pnpm run typecheck`
  - `pnpm run test`
- Documentation changes require `pnpm run docs:lint` before and after edits.
- For backlog-affecting changes, also run:
  - `pnpm run build`
  - `pnpm run backlog:validate`
  - `pnpm run backlog:validate:ci`
- Schema lifecycle changes require `pnpm run schemas:policy:check`.
- If a required validation command cannot run, record the exact command, failure
  reason, and residual risk in the task evidence or final report.

## Security And Automation Safety

- Never hardcode secrets, tokens, credentials, or machine-local absolute paths in
  committed source, schemas, docs, templates, or tests.
- Do not modify branch protections, repository secrets, CI triggers, required
  checks, hooks, file permissions, or access controls unless the current task
  explicitly authorizes that exact change.
- Do not bypass claim, evidence, validation, or merge gates. If a gate blocks the
  task, stop and report the blocker instead of weakening the gate.
- Keep generated artifacts out of commits unless the task or validation contract
  requires them.

## Commit And Handoff

- Commit only the files needed for the claimed task. Leave unrelated worktree
  changes untouched.
- Use the repository conventional commit format, such as `feat(scope): summary`,
  `fix(scope): summary`, `test(scope): summary`, or `docs(scope): summary`.
- Include the completed task, PRD reference when applicable, key decisions,
  files changed, validation run, and blockers or follow-up notes.
- Record evidence with the active claim before handing off successful work. Keep
  the claim active after success so the merge phase can close the task.
