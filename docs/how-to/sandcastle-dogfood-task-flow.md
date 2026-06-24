---
id: howto-60358
title: Sandcastle Dogfood Task Flow
type: document
subtype: how-to
lifecycle: active
status: ready
tags:
  - sandcastle
  - dogfood
  - task-cli
---

# Sandcastle Dogfood Task Flow

Use this local MVP flow when Sandcastle dogfoods Doc-Vader work items through the entity-governance runtime.

## Initialization

Install the repository toolchain and export the runtime variables before starting a task:

- `pnpm install`
- `export CI=true`
- `export TMPDIR=/tmp`
- `export SANDCASTLE_CLAIM_HOLDER="sandcastle:<agent-id>"`
- `export SANDCASTLE_BRANCH="sandcastle/issue-<task-id>"`

Keep `git`, `node`, `pnpm`, and the local runtime authority available. Do not use inline scripts or hand-edit backlog or record files during Sandcastle execution.

## Registry Mapping

Use these commands to map Sandcastle registry operations onto Doc-Vader:

| Registry operation | Doc-Vader command |
| --- | --- |
| Select AFK-ready work | `dv task ready --json` |
| Inspect a work item | `dv task show <task-id> --json` |
| Claim a task | `dv task claim <task-id> --holder <agent-id> --branch <branch> --json` |
| Acquire file locks | `dv lock create --claim <claim-token> <path...> --json` |
| Release unchanged locks | `dv lock rm --claim <claim-token> <path...> --json` |
| Record evidence | `dv task record --claim <claim-id> --payload <json-or-file> --json` |
| Release a successful claim | `dv claim release <claim-token> --outcome success --json` |
| Release a blocked claim | `dv claim release <claim-token> --outcome blocked --json` |
| Recover a halted task | `dv task recover <task-id>` |

## Flow

1. Select work:

   ```bash
   dv task ready --json
   ```

2. Claim before implementation:

   ```bash
   dv task claim <task-id> --holder <agent-id> --branch <branch> --worktree <path> --json
   ```

3. Lock files before editing:

   ```bash
   dv lock create --claim <claim-token> <path...> --json
   ```

4. Inspect the authoritative model:

   ```bash
   dv task show <task-id> --json
   ```

5. Render the implementation prompt from the same model:

   ```bash
   dv task prompt <task-id>
   ```

6. Implement and validate with repository-native commands.

7. Record evidence through the active claim:

   ```bash
   dv task record --claim <claim-id> --payload payload.json --json
   ```

8. Release the runtime claim with the correct outcome:

   ```bash
   dv claim release <claim-token> --outcome success --json
   ```

   ```bash
   dv claim release <claim-token> --outcome blocked --json
   ```

## Safety Boundary

Runtime claim release does not directly close or finalize the Work Item. A human or follow-on agent must review validation output, linked evidence, and existing closure gates before any Work Item lifecycle close/finalize action.

This milestone intentionally defers full Work Graph or Decision Graph engines, scope graphs, nested artifact reservations, hosted authority, and automatic Work Item close/finalize.

Hosted SaaS and published GitHub App concerns stay with [[60338-hosted-saas-github-app-architecture-adr]].
