# Doc-Vader Sandcastle Issue Tracker Extension

Sandcastle initializer for using Doc-Vader (`dv`) work items as a custom issue
tracker. The extension is packaged outside core Doc-Vader, but once installed it
adds commands to the single `dv` command surface.

## Install into a workspace

Register the extension in the local Doc-Vader extension store:

```sh
dv extensions install @calan-co/dv-sandcastle-issue-tracker
```

For this source checkout, install the local extension module:

```sh
dv extensions install ./extensions/dv-sandcastle-issue-tracker/index.mjs
```

Installed extensions are recorded in `.doc-vader/extensions/manifest.json`.
No `package.json` hand editing is required.

## Usage

Post-init mode:

```sh
npx @ai-hero/sandcastle init
dv sandcastle init
```

Proxy mode:

```sh
dv sandcastle init --run-sandcastle-init -- --template parallel-planner
```

Useful options:

```sh
dv sandcastle init --root /path/to/repo
dv sandcastle init --dry-run --json
```

A standalone binary remains available for package-manager workflows:

```sh
dv-sandcastle-init --dry-run --json
```

## What it changes

The extension writes `.sandcastle/dv4sandcastle.mjs` and
`.sandcastle/SETUP_ISSUE_TRACKER.md`, then patches Sandcastle prompt placeholders
so the scaffold calls:

- `node .sandcastle/dv4sandcastle.mjs list`
- `node .sandcastle/dv4sandcastle.mjs view <task-id>`
- `node .sandcastle/dv4sandcastle.mjs close-task <task-id>`

The adapter delegates to `dv work` commands. Set `DV_COMMAND` if `dv` is not on
`PATH`, for example:

```sh
DV_COMMAND="pnpm exec dv" dv sandcastle init
```

Closing is repository-policy-specific. Set `DV_SANDCASTLE_CLOSE_COMMAND` to the
repo's terminal transition command before using `close-task`.
