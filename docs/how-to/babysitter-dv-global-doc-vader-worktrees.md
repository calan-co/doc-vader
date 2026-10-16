---
id: babysitt-60507
title: Run Babysitter-DV with Global Doc-Vader in Isolated Worktrees
type: document
subtype: generic
lifecycle: active
status: closed
---

## Goal

Run Linkity-cutover work with the globally installed `dv` command while keeping
all source, runtime, and Babysitter writes inside the selected worktree.

## Select exactly one worktree

The current Linkity planning worktree is:

```sh
LINKITY_ROOT=/private/tmp/doc-vader-linkity-cutover
LINKITY_BRANCH=docs/linkity-cutover
```

The base checkout is `/Users/macos/dev/org/calan-co/doc-vader`; do not use it
for implementation. Inspect all worktrees before starting:

```sh
git -C /Users/macos/dev/org/calan-co/doc-vader worktree list --porcelain
cd "$LINKITY_ROOT"
test "$PWD" = "$LINKITY_ROOT"
test "$(git branch --show-current)" = "$LINKITY_BRANCH"
git status --short
```

Use a new worktree and branch for each executable Linkity item. Do not share a
worktree between `wi-60508` through `wi-60512`, and do not use a detached
assessment worktree as an implementation target.

```sh
git -C /Users/macos/dev/org/calan-co/doc-vader worktree add \
  -b linkity/wi-60509 /private/tmp/doc-vader-wi-60509 origin/staging
```

## Identify the global Doc-Vader command

Never use `pnpm exec dv`, `pnpm run dv`, `npx dv`, or `node dist/cli/doc-vader.js`
for this workflow: each can select the checkout under the current directory.
Capture the global executable once, then invoke that absolute path.

```sh
export DV_BIN="$(command -v dv)"
test "$DV_BIN" = "$HOME/Library/pnpm/dv"
test -x "$DV_BIN"
"$DV_BIN" --version
pnpm root -g
```

In the current terminal, the expected executable is
`/Users/macos/Library/pnpm/dv`. Verify the installed package separately from
CLI display text:

```sh
GLOBAL_PNPM_ROOT="$(pnpm root -g)"
GLOBAL_DV_PACKAGE="$(
  find "$GLOBAL_PNPM_ROOT" -type f \
    \( -path '*/node_modules/@calan-co/doc-vader/package.json' \
       -o -path '*/@calan-co/doc-vader/package.json' \) \
    -print -quit
)"
test -n "$GLOBAL_DV_PACKAGE"
node -p "require('$GLOBAL_DV_PACKAGE').version"
```

Before every task, confirm that `dv` is global but its project context is the
selected worktree:

```sh
cd "$LINKITY_ROOT"
printf 'project=%s\nbranch=%s\ndv=%s\n' "$PWD" "$(git branch --show-current)" "$DV_BIN"
"$DV_BIN" work status wi-60507 --json
```

If `command -v dv` is below `node_modules/.bin`, inside a worktree, or differs
from `$DV_BIN`, stop and fix `PATH`; do not run a task.

## Set the execution environment

Use the selected worktree as the only project directory. Keep pnpm's global
shim and the active fnm Node installation on `PATH`.

```sh
cd "$LINKITY_ROOT"
export PATH="$HOME/Library/pnpm:/Users/macos/.local/share/fnm/node-versions/v24.16.0/installation/lib/node_modules/corepack/shims:$PATH"
hash -r
command -v node pnpm dv
node --version
pnpm --version
```

The exact fnm multishell path is terminal-specific. If `pnpm` is missing, open
a shell with fnm initialized or use the verified Corepack shim above; do not
install dependencies into the global Doc-Vader package to compensate.

## Create a worktree-local Babysitter run

Keep Babysitter state out of `~/.a5c/runs` and out of the global package. Pass
an explicit run directory under the selected worktree and make the selected
project directory an explicit process input.

```sh
RUNS_DIR="$LINKITY_ROOT/.a5c/runs"
mkdir -p "$RUNS_DIR"
printf '{"projectDir":"%s","dvBin":"%s","workItem":"wi-60509"}\n' \
  "$LINKITY_ROOT" "$DV_BIN" > "$LINKITY_ROOT/.a5c/linkity-inputs.json"

babysitter run:create \
  --runs-dir "$RUNS_DIR" \
  --process-id babysitter-afk-doc-vader \
  --entry "$LINKITY_ROOT/blueprints/babysitter-afk-v6/process.mjs#process" \
  --inputs "$LINKITY_ROOT/.a5c/linkity-inputs.json" \
  --prompt 'Implement wi-60509 only in the selected Linkity worktree.' \
  --harness pi --non-interactive --json
```

Before posting or executing every effect, inspect its paths. It must name only
`$LINKITY_ROOT`, `$RUNS_DIR`, and `$DV_BIN`:

```sh
babysitter task:list "$RUNS_DIR/<run-id>" --pending --json
babysitter run:events "$RUNS_DIR/<run-id>" --json
```

Allow effects to read or execute `$DV_BIN`, but reject any effect that writes to
`$DV_BIN`, `$GLOBAL_DV_ROOT`, the base checkout, another
`/private/tmp/doc-vader-*` directory, or an unapproved shared run directory.

## Concurrent worktrees

Give each work item its own branch, worktree, inputs file, and `--runs-dir`.
Use unique claim and run identifiers, and never run cleanup from a sibling
worktree. A global `dv` binary is safe to share because it is executed, not
modified; all project reads and writes follow the current worktree.

Coordinate integration through `origin/staging`: rebase only the worktree that
owns the item, validate there, then merge through its pull request. Do not copy
`node_modules`, `.a5c/runs`, `.sandcastle`, claims, or generated audit files
between worktrees.

## Verification, rollback, and cleanup

Run these before handoff:

```sh
cd "$LINKITY_ROOT"
"$DV_BIN" work ready --json
pnpm run docs:lint
pnpm run backlog:validate
pnpm run backlog:validate:ci
git status --short
git diff --check
```

To stop a run, preserve its local journal first, then halt only that run:

```sh
babysitter run:halt "$RUNS_DIR/<run-id>" --reason 'operator rollback' --final-status failed --json
```

Rollback source with normal Git operations in the owning worktree only. Remove
a finished worktree only after its branch is merged or intentionally abandoned:

```sh
git -C /Users/macos/dev/org/calan-co/doc-vader worktree remove /private/tmp/doc-vader-wi-60509
git -C /Users/macos/dev/org/calan-co/doc-vader worktree prune
```

Do not delete `$HOME/Library/pnpm`, `$GLOBAL_DV_ROOT`, the base checkout, or
another worktree as part of Linkity cleanup.
