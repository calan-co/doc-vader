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

Run these gates serially. Do not start `pnpm run test` while `typecheck`,
`docs:lint`, `backlog:validate`, or `backlog:validate:ci` is still running.
The full Vitest suite launches many child-process CLI checks; running it beside
other Nx/TypeScript gates can exhaust the sandbox and produce killed-process
noise that is not a code failure.

`pnpm run test` intentionally prints stderr from negative-path CLI tests
including JSON error payloads, help text, invalid option messages, missing
config messages, and recovery/claim failures. Do not classify that output as a
test failure by inspection. Only the final process exit code and final Vitest/Nx
summary decide whether the test gate failed.

If an Nx-backed command fails with a daemon or permission error, retry once with
`NX_DAEMON=false`. If the same environment error remains, collect a stable
repo-script signal where available:

- tests: `pnpm exec vitest run`
- docs: `node --import tsx scripts/validate-docs.ts --docs-dir docs`
- ready-list sanity: `node .sandcastle/list-ready-issues.mjs`

If a gate appears to fail:

1. Capture the final failing test file, assertion, or process error from the
   command output.
2. Rerun the exact failing file or focused test once.
3. Only call a failure "pre-existing" after reproducing the same failure on the
   merge base or pre-merge branch. Record the command and result used for that
   comparison.

Report environment-only failures separately from code failures. Do not mark a
branch complete when the direct validation signal fails for the changed area.
