---
id: wi-60361
title: Git SQLite Local Multi Agent Runtime Contract
summary: Capture the approved local multi-agent runtime contract for Sandcastle AFK execution before implementation slices change the command surface.
type: work-item
subtype: story
lifecycle: active
status: completed
status_reason: completed
priority: critical
estimated: 3
actual: 3
completed_date: '2026-06-19'
links:
  evidence:
    - '[[record-20260619-runtime-contract-60361]]'
  reference:
    - '[[60339-agent-command-surface-for-skills-and-sandcastle]]'
    - '[[60340-artifact-graph-and-nested-claim-architecture-adr]]'
    - '[[60356-fail-closed-ready-selection-cli]]'
    - '[[60357-claim-aware-task-record-payload]]'
    - '[[60358-sandcastle-dogfood-adapter-flow]]'
tags:
  - hitl
  - afk
  - sandcastle
  - runtime
  - sqlite
  - multi-agent
---

## Goal

Record the approved MVP contract for deterministic local multi-agent Sandcastle execution over Doc-Vader tasks, using Git worktrees and a SQLite runtime store as the local authority.

## Background

The earlier dogfood MVP assumed a conservative local claim lock. The approved successor model supports multiple local agents by making runtime ownership explicit: every execution has a claim, every mutable file artifact requires a lock, and lifecycle commands enforce changed-file lock audits instead of relying on advisory hooks or prompt instructions.

## Runtime Contract

The target domain model is a shared runtime authority. The MVP adapter is one Git repository plus one SQLite runtime store under the configured Doc-Vader runtime directory. Multi-repo work is coordinated above this adapter by creating and linking per-repo work items; one local SQLite store never spans multiple Git repository roots.

Locks are cooperative mutation guards within one shared runtime authority. They reduce same-path contention between agents that use the same runtime store, including agents in separate Git worktrees. They do not serialize Git history, detect unseen base-branch changes, prevent external edits, or make branch merges safe by themselves. Terminal success still requires freshness, mergeability, validation, and changed-file lock audits.

### Runtime Tables

The SQLite adapter owns three runtime tables:

- `claims`: live execution ownership records.
- `locks`: live mutable-artifact mutex records.
- `execution_log`: append-only execution attempt summaries.

MVP uses one public ownership token, `claim_token`. There is no separate public or durable `execution_id` in MVP. The same `claim_token` correlates `claims`, `locks`, and `execution_log` rows.

`claims` core fields are `claim_token`, `target_type`, `target_id`, `holder`, `expires_at`, `created_at`, and `metadata`. Live claims must be unique by `(target_type, target_id)`. `claim_token` is a hash of the canonical static claim record, including generated entropy so otherwise identical claims cannot collide. A claim token is an ownership and correlation handle, not an authorization secret.

`claims.state` is not manually persisted. Claim state is centrally derived as `active | expired` from `expires_at`, preferably through a SQLite view or equivalent query surface. Expired claims remain live and blocking until explicit claim cleanup.

`locks` core fields are `key`, `path`, `claim_token`, `target_type`, `target_id`, `created_at`, and metadata. Locks do not have independent expiry; lock liveness is inherited from the owning claim. A lock without a claim is invalid runtime corruption. `locks.key` and `locks.path` have table-level unique constraints.

`execution_log` stores bounded summary entries, not full live runtime snapshots. Its indexed fields include `claim_token`, `target_type`, `target_id`, `state`, `reason`, `created_at`, and `payload`. `payload` is canonical JSON text validated by TypeScript before insert and includes `schema_version`.

### Execution State

Execution state and reason are a compatibility matrix:

| State | Valid reasons |
| --- | --- |
| `running` | `started` |
| `completed` | `success` |
| `failed` | `error` |
| `halted` | `conflict`, `blocked`, `invalid`, `expired`, `revoked`, `cancelled` |

`running` is the only non-terminal state. `completed`, `failed`, and `halted` are terminal for the execution attempt. Recovery creates a new claim/execution attempt and does not reopen an old halted attempt.

The only ready-permitting latest execution-log pair is `completed + success`. Successful normal execution and successful recovery both use `completed + success`; reporting can reconstruct context from earlier log entries.

### Command Surface

`dv claim create --target task:<task-id>` creates a task claim. `dv task claim <task-id>` is a convenience alias. Claims may be created with zero locks; locks are acquired lazily as mutation targets become known.

`dv claim` with no subcommand returns bulk claim status for all live claims. Other bulk-capable claim commands require exactly one selector: `<claim-token>` or `--filter <filter-string>`. Bare mutating commands must fail and show help.

MVP claim filters are expiry time filters only:

- `until=now`
- `until=24h`
- `until=60m`
- `until=60s`

Claim transition commands are verbs, not arbitrary state setters. They mark the claim execution attempt, append to `execution_log`, and clean up runtime ownership. They do not directly progress work-item Markdown status:

- `dv claim complete <claim-token>` appends `completed + success`, then internally removes the claim and owned locks.
- `dv claim halt <claim-token> --reason conflict|blocked|invalid|expired|revoked|cancelled` appends `halted + reason`, then internally removes the claim and owned locks.
- `dv claim halt --filter <time-filter> --reason expired` is the only MVP bulk transition.
- `dv claim fail <claim-token>` appends `failed + error`, then internally removes the claim and owned locks.
- `dv claim prune --filter <time-filter>` deletes terminal expired claims and owned locks only. It never mutates `execution_log`.
- `dv claim rm <claim-token>` deletes one terminal or expired claim and owned locks only. It refuses active running claims.

There is no standalone `dv task release` and no standalone `dv claim release`. Claim cleanup is an internal consequence of terminal claim transitions or explicit claim cleanup commands.

Lock commands are:

- `dv lock create --claim <claim-token> <path...>`
- `dv lock rm --claim <claim-token> <path...>`
- `dv lock status --claim <claim-token>`

`dv lock create` and `dv lock rm` are atomic for multiple paths. On any conflict, foreign lock, missing lock, modified path, or invalid target, the whole operation fails without partial changes. `dv lock rm` is allowed only for paths owned by the claim and still unmodified. Lock conflicts return structured diagnostics; they do not automatically halt the claim.

### Lock Identity

MVP lock identity is a normalized repo-relative file path. Paths do not need to exist before they can be locked. Future granular artifacts can suffix the normalized path, such as `backlog/60361-git-sqlite-local-multi-agent-runtime-contract.md#Summary`.

`locks.path` stores the normalized identity string. `locks.key` is `sha256(utf8(locks.path))`.

Path normalization resolves the input against the current working directory, anchors it to the repository root, rejects repo escape, uses POSIX `/` separators, normalizes `.` and `..`, and applies casing based on Git `core.ignorecase`. When `core.ignorecase=true`, existing tracked path components canonicalize to Git-index casing where possible; new path segments keep caller-provided casing. When `core.ignorecase=false`, casing is preserved and case-distinct paths are distinct identities.

Directory locks are out of MVP. MVP locks target file path identities only.

### Readiness

`dv task ready` evaluates only work-item Markdown and latest execution-log entry:

```text
ready = work-item Markdown is AFK-ready AND latest execution_log entry is ready-permitting
```

Live `claims` and `locks` are not normal ready-selection inputs. They are hydrated by claim, lock, audit, halt, recover, record, close, prune, and other lifecycle paths. If hydration detects conflict or inconsistency, those commands fail closed and append or preserve a bounded `halted` guardrail where appropriate.

`dv claim create` must also fail when the target's latest execution-log entry is not ready-permitting, even if no live claim exists. `recover` is the path that can prove a halted target is safe and append `completed + success`.

### Git Lifecycle Gates

Terminal success commands, including `dv claim complete` and finalization paths, must verify:

- The current branch/worktree is fresh and mergeable against the configured merge target.
- Every changed file in the current branch/worktree diff against the configured merge target is locked by the active claim.
- Repository validation gates pass.

Claims do not require `base_ref`, `base_sha`, or `claim_start_head_sha` as core fields. The Git adapter may store diagnostic Git metadata in claim metadata, but terminal success always uses the current configured merge target.

`halt` and `fail` are safety exits and do not require freshness or mergeability. They must preserve blocker context and remove runtime ownership.

MVP changed-file audit rejects Git-detected renames, including case-only renames. There is no automatic lock retargeting and no folder-lock fallback. Rename support requires follow-on design for an explicit move operation.

Git hooks may call shared audits, but hooks are advisory. Authoritative enforcement happens in Doc-Vader lifecycle commands.

### Recovery

`recover` is a normal execution operation, not a privileged bypass. It creates a new claim, acquires required locks through the normal lock flow, verifies Markdown/AFK state, validation, freshness, mergeability where needed, and lock coverage, then appends `completed + success` if the target is safe to resume. Any `halted` reason is recoverable in principle when the safety checks pass.

`reconcile` is out of MVP.

## Tasks

- [x] Document the Git + SQLite local runtime adapter as the MVP authority implementation.
- [x] Define the runtime tables: `claims`, `locks`, and `execution_log`.
- [x] Define `claim_token` as the MVP ownership and execution correlation token.
- [x] Define `claim` as the live execution ownership record keyed by `claim_token`.
- [x] Define `lock` as a mutex over one file-path artifact, with every lock requiring a `claim_token`.
- [x] Define MVP artifact identity as normalized repo-relative file path plus future fragment suffix support.
- [x] Specify that `locks` is live-state only with table-level unique constraints on `key` and `path`.
- [x] Specify that `claims` is live-state only with derived `active` and `expired` states.
- [x] Specify append-only summary `execution_log_entry` payloads.
- [x] Define execution states, reason compatibility, and ready-permitting state.
- [x] Define `dv claim` and `dv lock` command surfaces.
- [x] State that hooks are advisory and `dv task` lifecycle commands are authoritative enforcement gates.
- [x] Define fail-closed readiness composition over work-item Markdown and latest execution log.
- [x] Define terminal success freshness, mergeability, and cumulative branch-diff lock audit requirements.
- [x] State that `recover` uses normal claim and lock flow and that `reconcile` is out of MVP.

## Deliverables

- A durable contract section in this work item or a linked decision document.
- Follow-on implementation slices that can proceed without reopening the MVP runtime model.

## Acceptance criteria

- [x] The contract distinguishes the target domain model from the local Git + SQLite MVP adapter.
- [x] The contract defines the exact runtime table responsibilities and live-state rules.
- [x] The contract defines authoritative enforcement points for changed-file lock audits.
- [x] The contract defines how `complete`, `halt`, `fail`, `recover`, `ready`, and cleanup commands compose runtime state.
- [x] The contract explicitly avoids relying on Git hooks, `AGENTS.md`, or prompt instructions as deterministic enforcement.
- [x] AFK implementation items can reference this contract without requiring further HITL decisions.

## Blocked by

None - can start immediately.
