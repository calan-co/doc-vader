---
id: howto-60358
title: Sandcastle dv4sandcastle Work Flow
type: document
subtype: how-to
lifecycle: active
status: ready
tags:
  - sandcastle
  - dv4sandcastle
  - work-management
---

# Sandcastle dv4sandcastle Work Flow

Use this guide as the current operator contract for Sandcastle planning and
execution in this repository. Completed backlog items remain historical context, not authoritative current guidance.

## Initialization

Install the repository toolchain before starting work:

- `export CI=true`
- `export TMPDIR=/tmp`
- `scripts/sandcastle/prewarm-validation-env.sh`

Keep `git`, `node`, `pnpm`, and the local runtime authority available.
A greenfield readiness proof starts from a temporary workspace fixture whose target repository checkout does not contain a `.sandcastle/` directory before `sandcastle init` runs.
`sandcastle init` is the scaffold creation step for a Doc-Vader-backed workflow.
The supported issue-tracker template inputs include planning, inspection, prompt, claim, checklist, lock, record, recovery, and close command strings.
After `sandcastle init`, the generated `.sandcastle/SETUP_ISSUE_TRACKER.md` expands the working contract with `dv4sandcastle` planning, inspection, prompt, claim, checklist, lock, record, recovery, and terminal close commands.
This repository may still retain committed convenience copies of `.sandcastle/` files, but those checked-in files are not the greenfield proof input and do not replace init-generated artifacts in a temporary validation fixture. Init templates are the artifact source of truth, and fresh temporary-workspace scaffolds prove readiness.

## Prewarm Validation Bootstrap

Run `scripts/sandcastle/prewarm-validation-env.sh` once per fresh checkout
from the environment that can reach the registry and write local caches. The
script performs the package-manager bootstrap and dependency install up front,
then probes the exact toolchain needed by the baseline gates:

1. `corepack install`
2. `pnpm install --frozen-lockfile`
3. `pnpm exec nx --version`
4. `pnpm exec tsc --version`
5. `pnpm exec vitest --version`

The bootstrap keeps cache paths explicit so later agent runs can stay
sandboxed:

| Variable                      | Default path          | Role                                                         |
| ----------------------------- | --------------------- | ------------------------------------------------------------ |
| `COREPACK_HOME`               | `.corepack/`          | Pinned pnpm download plus supply-chain verification cache.   |
| `pnpm_config_store_dir`       | `.pnpm-store/`        | Dependency store reused by `pnpm install` and later scripts. |
| `NX_CACHE_DIRECTORY`          | `.nx/cache/`          | Nx task output cache.                                        |
| `NX_WORKSPACE_DATA_DIRECTORY` | `.nx/workspace-data/` | Nx workspace metadata used to start targets.                 |
| `TMPDIR`                      | `/tmp`                | Writable temp space for child processes and wrappers.        |
| `CI`                          | `true`                | Stable non-interactive validation behavior.                  |

TypeScript does not currently use a persistent incremental cache in this repo,
so the bootstrap only confirms `tsc` is present after dependency install.
Vitest does not define a separate repo-owned cache variable here; validating the
binary availability is enough before the later `pnpm run test` gate does real
work through Nx.

After the prewarm step finishes, use the normal baseline entrypoints directly:

```sh
pnpm run typecheck
pnpm run test
pnpm run docs:lint
pnpm run backlog:validate
```

Use the docs and backlog gates when the corresponding files changed.
The repo-owned Vitest config caps worker fan-out by default so `pnpm run test`
fits typical agent memory budgets; set `VITEST_MAX_WORKERS` only when a host
can safely support a higher count.

## Cold-Start Harness

When you need a repeatable cold-start proof for Codex or another agent, run
`node --import tsx scripts/sandcastle/cold-start-validation-harness.ts`.
The repo-owned harness entrypoint lives at
`scripts/sandcastle/cold-start-validation-harness.ts`.
The harness creates a fresh cache boundary under
`.sandcastle/cold-start/<run-id>/cache`, reruns the prewarm bootstrap inside
that boundary, sets `NX_SOCKET_DIR` to a short `/tmp/nx-<run-id>` path, keeps
`TMPDIR` under `/tmp/doc-vader-cold-start/<run-id>/tmp` outside the repository
worktree, and then executes the baseline gates serially with the same
environment variables.

Each harness run writes `.sandcastle/cold-start/<run-id>/report.json` and
`.sandcastle/cold-start/<run-id>/record-payload.json`. The JSON report records
start time, duration, exit status, failure classification, and log path for
every step so the result can distinguish environment, validation, or product defects.

Use the classifications this way:

- `environment`: pnpm verification, registry access, cache permissions, or
  temp-directory problems before meaningful validation starts
- `validation`: `pnpm run docs:lint` or `pnpm run backlog:validate` findings
- `product_defect`: `pnpm run typecheck` or `pnpm run test` failures after the
  toolchain starts real repository validation

If the harness stops with `environment`, inspect pnpm verification plus
`COREPACK_HOME`, `pnpm_config_store_dir`, `NX_CACHE_DIRECTORY`,
`NX_SOCKET_DIR`, `NX_WORKSPACE_DATA_DIRECTORY`, and `TMPDIR` before rerunning.

## Greenfield Readiness Proof

Run `node --import tsx scripts/sandcastle/greenfield-readiness-harness.ts`
when you intentionally want a full greenfield Sandcastle readiness proof.
The full greenfield e2e proof is opt-in local validation and does not run
inside the default `pnpm run test` gate.

The repo-owned readiness wrapper stages a temporary workspace, starts from
`sandcastle init`, runs the existing greenfield success and recovery harness,
and records whether the repo's committed `.sandcastle/` files are in sync with
the generated scaffold manifest. Each readiness proof writes
`.sandcastle/greenfield-readiness/<run-id>/report.json` and
`.sandcastle/greenfield-readiness/<run-id>/record-payload.json`.

Use the report for triage:

- `sandcastle-setup`: Sandcastle bootstrap, `sandcastle init`, or scaffold
  generation regressed before the `dv4sandcastle` contract could be exercised.
- `doc-vader-contract`: adapter command names, arguments, rendered prompts, or
  command output drifted from the documented `dv4sandcastle` contract.
- `implementation`: repository transition behavior or close/recover semantics
  regressed after the adapter contract was reached successfully.

Refresh the readiness evidence after Sandcastle, the generated `.sandcastle`
contract, or `dv4sandcastle` behavior changes. Treat checked-in `.sandcastle/`
files as convenience copies only; the temporary workspace manifest created by
`sandcastle init` remains the source of truth for readiness.

## Validation Environment Policy

Use `.sandcastle/VALIDATION.md` as the execution policy for baseline gates.

- Request `require_escalated` before the first run when the current environment
  still needs pinned package-manager verification, networked registry access,
  dependency installation, or writable pnpm/Nx cache paths before validation
  can begin.
- Use `scripts/sandcastle/prewarm-validation-env.sh` for that first
  network-capable bootstrap so later `pnpm run typecheck` and `pnpm run test`
  start real validation work instead of a doomed package-manager setup attempt.
- Do not start with a knowingly blocked sandbox run for
  `pnpm run typecheck`, `pnpm run test`, `pnpm run docs:lint`, or
  `pnpm run backlog:validate`. Move directly to the prewarmed or escalated
  environment that can run the command honestly.
- Keep the lightweight `dv4sandcastle` contract tests in `pnpm run test`, but
  leave the full greenfield readiness proof on the opt-in command above.
- Treat escalation as environment setup only. It does not bypass branch
  protection, secrets, CI triggers, hooks, or file-permission boundaries.
- After the environment is ready, run the baseline gates serially and report
  environment-only failures separately from real code failures.

## Authority Model

- [`dv work <work-item-id> <operation>`](../reference/work-management/work-item-lifecycle-commands.md) is the canonical public command surface and the only Work Item command grammar.
- `dv wi` and `dv task` are unavailable.
- `dv4sandcastle` is the Sandcastle adapter that translates issue
  tracker operations into `dv work` and runtime commands.
- Checklist, status, evidence, claim, and lock behavior remain authoritative in
  repository state plus runtime state, not in prompt text.
- The only required coupling between Doc-Vader and Sandcastle is the `dv4sandcastle` CLI contract plus the generated command strings that point at it.
- Sandcastle-specific behavior is assigned to Sandcastle, not Doc-Vader.

## Sandcastle Adapter Contract

Use these commands for the current Sandcastle-facing contract:

| Operation                                  | Command                                                                                                                                        | Authority                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| List planning candidates                   | `node --import tsx scripts/sandcastle/dv4sandcastle.ts list`                                                                                   | `dv work ready --json`                                                |
| View canonical work item JSON              | `node --import tsx scripts/sandcastle/dv4sandcastle.ts view <task-id>`                                                                         | `dv work <task-id> show`                                              |
| Render implementation prompt               | `node --import tsx scripts/sandcastle/dv4sandcastle.ts prompt <task-id>`                                                                       | `dv work <task-id> prompt`                                            |
| Claim work                                 | `node --import tsx scripts/sandcastle/dv4sandcastle.ts claim-task <task-id> --holder <holder> --branch <branch> --json`                        | `dv work <task-id> claim`                                             |
| Inspect pack-discovered checklists         | `dv work <task-id> checklist [<checklist-id>]`                                                                                                 | selected Work Item document-type pack                                  |
| Complete or clear one checklist check      | `dv work <task-id> checklist <checklist-id> check <check-id> complete|clear --claim <claim-id>`                                                | claim-bound pack-native check transaction                              |
| Inspect runtime state for the active claim | `node --import tsx scripts/sandcastle/dv4sandcastle.ts lock-status --claim <claim-id> --json`                                                  | runtime claim and execution state                                     |
| Record evidence                            | `node --import tsx scripts/sandcastle/dv4sandcastle.ts record-task --claim <claim-id> --type <record-type> --payload <json-file\|-> --json`    | `dv work <task-id> record`                                            |
| Recover halted work                        | `node --import tsx scripts/sandcastle/dv4sandcastle.ts recover-task <task-id> --branch <branch> --json`                                        | `dv work <task-id> recover`                                           |
| Close after validation passes              | `node --import tsx scripts/sandcastle/dv4sandcastle.ts close-task <task-id> --claim <claim-id> [--payload <json-file>] [--record-type <type>]` | repository-configured transition script plus successful claim release |

Together, these commands cover planning, inspection, claim, check completion, prompt, recovery, and implementation handoff for the Doc-Vader side of the workflow.

After claiming, inspect the current pack-discovered checklist before targeted completion or clearing. Check IDs are revision-scoped; re-inspect after an address-drift error rather than retrying. Do not edit raw Markdown checkboxes. Record evidence before `close-task`; its terminal Gate surfaces unmet checks, missing evidence, lifecycle failures, and invalid or expired Claims before it can release successfully.

## Agent Workflows MVP Manual Check

Use this fallback prompt when validating a local Agent Workflows MVP handoff
outside the default Doc-Vader test suite:

```text
Create a disposable repository fixture with three AFK-ready work items named
wi-001, wi-002, and wi-003. Include terminal metadata (`actual` and
`links.evidence`) when exercising the successful close path. From the fixture
root, run Doc-Vader's CLI by absolute path:

node --import tsx /Users/macos/dev/tiab/doc-vader/cli/doc-vader.ts work ready --json --backlog-dir backlog
node --import tsx /Users/macos/dev/tiab/doc-vader/cli/doc-vader.ts work wi-001 update --input '{"status":"completed","statusReason":"completed","actual":0}' --json --backlog-dir backlog
node --import tsx /Users/macos/dev/tiab/doc-vader/cli/doc-vader.ts work wi-002 update --input '{"status":"completed","statusReason":"completed","actual":0}' --json --backlog-dir backlog
node --import tsx /Users/macos/dev/tiab/doc-vader/cli/doc-vader.ts work wi-003 update --input '{"status":"completed","statusReason":"completed","actual":0}' --json --backlog-dir backlog
node --import tsx /Users/macos/dev/tiab/doc-vader/cli/doc-vader.ts work wi-001 status --json --backlog-dir backlog
node --import tsx /Users/macos/dev/tiab/doc-vader/cli/doc-vader.ts work wi-002 status --json --backlog-dir backlog
node --import tsx /Users/macos/dev/tiab/doc-vader/cli/doc-vader.ts work wi-003 status --json --backlog-dir backlog
node --import tsx /Users/macos/dev/tiab/doc-vader/cli/doc-vader.ts work ready --json --backlog-dir backlog

Expected pass signal: the first ready call returns exactly wi-001, wi-002,
and wi-003; each close call succeeds and persists canonical status completed;
each status call reports completed; the second ready call returns no candidates
with ids wi-001, wi-002, or wi-003 and reports them only as closed exclusions.
If /Users/macos/dev/pi-extensions is available, run the same command contract
from the Agent Workflows adapter and treat any repeated completed work ids as a
Doc-Vader/adapter integration failure.
```

The repository-owned deterministic version is
`tests/agent-workflows-mvp-e2e-contract.test.ts`; the optional
`/Users/macos/dev/pi-extensions` run is a cross-repository smoke check, not a
default CI dependency.

## Planning Context

`dv4sandcastle list` is a Sandcastle-specific, filtered planning view over
`dv work ready --json`.

- `selectable` entries are the only candidates Sandcastle should claim.
- Non-selectable horizon entries are intentionally withheld from the list
  output so the planner cannot choose dependency-blocked, claimed, HITL, or
  halted work.
- Claim and recovery commands still revalidate runtime state and can explain
  why a specific item is not selectable.
- The adapter can supply a branch name like `sandcastle/issue-60415`, but the
  source of truth for readiness still lives in `dv work`.

## Close and Recovery

Use the success path only after validation passes and the claim still reflects
the current branch state.

- `close-task` is the terminal success path. Its behavioral authority comes
  from the runtime claim release flow and any repository-configured transition
  script, including checklist updates or side effects outside the backlog file.
- A repository-configured transition script may plan lock requirements before it
  mutates files. That script, not the prompt, owns repository-specific
  checklist and transition behavior.
- Explicit non-success exits stay on the runtime command surface:
  `dv claim release <claim-token> --outcome <outcome> --json`.
- If a close attempt fails after record creation or transition planning, treat
  the work item as recoverable, inspect the active claim with
  `node --import tsx scripts/sandcastle/dv4sandcastle.ts lock-status --claim <claim-id> --json`,
  and recover through
  `node --import tsx scripts/sandcastle/dv4sandcastle.ts recover-task <task-id> --branch <branch> --json`.

## Cross-References

- Adapter entrypoint:
  [`scripts/sandcastle/dv4sandcastle.ts`](../../scripts/sandcastle/dv4sandcastle.ts)
- Generated issue-tracker wiring:
  [`.sandcastle/SETUP_ISSUE_TRACKER.md`](../../.sandcastle/SETUP_ISSUE_TRACKER.md)
- Sandcastle validation matrix:
  [`.sandcastle/VALIDATION.md`](../../.sandcastle/VALIDATION.md)
- Implementation PRD:
  [doc-vader-sandcastle-ready-work-cli-prd.md](./implementation-plans/doc-vader-sandcastle-ready-work-cli-prd.md)
- Validation gates:
  `pnpm run typecheck`, `pnpm run test`, and, for documentation or backlog
  edits, `pnpm run docs:lint`, `pnpm run backlog:validate`, and
  `pnpm run backlog:validate:ci`.

## Test Ownership

Doc-Vader contract tests cover the rendered command contract, the repository-owned guide, and the temporary fixture assumptions.
Sandcastle-owned tests cover `sandcastle init`, workspace provisioning, planner execution, and implementation-loop behavior outside the `dv4sandcastle` CLI contract.

## Safety Boundary

Do not use inline helper scripts, completed backlog history, or hand-edited
status/checklist changes as a substitute for the current `dv work` plus
`dv4sandcastle` contract. Sandcastle should plan through `list`, inspect
through `view` and `prompt`, mutate through claimed runtime commands, and rely
on recovery plus repository-configured transition behavior when interrupted.
