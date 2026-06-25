# Sandcastle Validation Matrix

Sandcastle sandboxes are expected to provide `pnpm`, `rg`, `git`, `node`, and
`corepack` on `PATH`. Treat a missing executable as an environment failure, not
as a project failure.

Use these gates for normal implementation and merge work:

1. `pnpm run typecheck`
2. `pnpm run test`
3. For documentation or backlog edits, also run:
   - `pnpm run docs:lint`
   - `pnpm run backlog:validate`
   - `pnpm run backlog:validate:ci`

If an Nx-backed command fails with a daemon or permission error, retry once with
`NX_DAEMON=false`. If the same environment error remains, collect a direct
signal instead:

- tests: `pnpm exec vitest run`
- docs: `node --import tsx scripts/validate-docs.ts --docs-dir docs`
- backlog: `node --import tsx cli/doc-vader.ts backlog validate -d backlog --format text --fail-on error`

Report environment-only failures separately from code failures. Do not mark a
branch complete when the direct validation signal fails for the changed area.
