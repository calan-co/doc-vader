---
$schema: schemas/work-management/frontmatter/prd.json
$content_schema: schemas/work-management/content/prd.json
$template: templates/reference/work-management/prd.md.tpl
id: plan:doc-vader-sandcastle-ready-work-cli-prd
title: Doc-Vader Sandcastle-Ready Work CLI PRD
summary: Make dv work the authoritative Sandcastle-ready selection and execution CLI through a dv4sandcastle adapter, AFK-safe filtering, configurable transitions, and recovery coverage.
type: plan
subtype: x-prd
lifecycle: active
status: ready
tags:
  - sandcastle
  - work-management
  - afk
  - dv4sandcastle
---

## Artifact Strategy

- Source of truth: `json-payload`
- Rendered views: `markdown`
- Preservation: Store this JSON payload next to the rendered Markdown PRD and treat the JSON as canonical for automation, AFK issue decomposition, and future Sandcastle adapter consumers.

## Context Grounding

Doc-Vader already has schema-backed Work Items, a primary `dv work` command surface with `dv wi` shorthand, a legacy `dv task` compatibility alias, a projected Work graph, Git plus SQLite runtime authority, runtime claims, locks, execution logs, changed-file lock audits, PRD JSON rendering, and an existing Sandcastle scaffold. The current scaffold still uses ad hoc `.sandcastle` list/view scripts and prompt instructions that can bypass `dv`; the Sandcastle-facing adapter still contains legacy JSON claim-store behavior. The required next step is to make `dv work` the authoritative work selection and execution interface, expose a small `dv4sandcastle` adapter for Sandcastle's issue-tracker expectations, and keep repository-specific transition/checklist mutation behind configurable scripts rather than hard-coding them into the core CLI.

### Domain Vocabulary

- Entity Governance

- Artifact

- Work

- Work Item

- Task

- Work Command Surface

- Task Projection

- Runtime Authority

- Runtime Entity

- Claim

- Lock

- Execution Log

- ScopeRef

- Storage Adapter

- Format Adapter

- Gate

- Finding

- Record

- Review Profile

- dv4sandcastle adapter

- selectable work

- horizon context

### ADR Alignment

Aligned with ADR-005 entity governance, ADR-006 Work Item canonicality and Sandcastle adapter posture, ADR-007 Git plus SQLite runtime authority, ADR-009 storage and format seams, and ADR-010 composable evaluation primitives. This PRD refines ADR-006 for the post-compatibility window: `dv task` should no longer remain public command surface, while Sandcastle integration becomes a `dv4sandcastle` adapter over `dv work` and runtime commands rather than a second source of lifecycle authority.

### Source Context

- Conversation decision: `task` was only preserved as a compatibility alias for one integration round and should be removed from the public command surface.

- Conversation decision: Sandcastle plan and implementation prompts should be generated from InitService template arguments rather than hand-edited in `.sandcastle`.

- Conversation decision: claim management should use `dv`-native commands and may be abstracted behind a Sandcastle adapter.

- Conversation decision: the adapter module should be named `dv4sandcastle`.

- Conversation decision: transition and checkbox mutation must be repository-customizable and should not require core `dv` code changes for each repository workflow.

- Conversation decision: Work progress should move toward graph, runtime records, scopes, dependencies, and repository scripts instead of a bespoke checkbox-only mark command.

- Conversation decision: `dv work` filtering should be decoupled from output formatting, with reusable policy expressions living in the adapter before named profiles are necessary.

- Conversation decision: Sandcastle selection should use a hybrid model: deterministic selectable candidates plus non-selectable horizon context for planner quality.

- Current code observation: `cli/doc-vader.ts` still registers `.alias("task")` on the Work command surface.

- Current code observation: `lib/work/command-inventory.ts` still includes `task` in `WORK_COMMAND_ALIASES`.

- Current code observation: `.sandcastle/plan-prompt.md` still calls `.sandcastle/list-ready-issues.mjs` instead of a `dv`-native list command.

- Current code observation: `.sandcastle/implement-prompt.md` still calls `.sandcastle/view-issue.mjs` and instructs direct backlog completion edits.

- Current code observation: `scripts/sandcastle/dv-adapter.ts` still reads and writes `.doc-vader/runtime/task-claims` JSON state.

- Current code observation: `templates/reference/task/sandcastle-prompt.md.tpl` already uses much of the newer `dv work` vocabulary but still contains temporary checklist language.

- Sandcastle InitService observation: built-in issue tracker template arguments are `LIST_TASKS_COMMAND`, `VIEW_TASK_COMMAND`, `CLOSE_TASK_COMMAND`, and `ISSUE_TRACKER_TOOLS`; the built-in issue-tracker shape is too small to own `dv` claim, lock, record, release, and recovery semantics directly.

## Problem Statement

Doc-Vader has most of the runtime and Work graph foundations needed for local AFK execution, but it is not yet a stable Sandcastle-ready authoritative CLI. Sandcastle currently sees generated prompt artifacts and adapter behavior that can bypass `dv`, while `dv` still exposes the deprecated `task` command alias and lacks a filterable work-selection contract that can provide both safe selectable work and broader planning context. If this remains unresolved, Sandcastle agents will either reason over partial ad hoc data, mutate Markdown directly, or recover from partial state through stale JSON claim behavior instead of the Git plus SQLite runtime authority.

## Solution

Make `dv work` the only public family-wide work command surface, with `dv wi` as shorthand and no public `dv task` alias. Add a `dv4sandcastle` adapter module that translates Sandcastle's issue-tracker template arguments into `dv work`, `dv claim`, `dv lock`, `dv work record`, repository transition scripts, and `dv work recover` calls. Add a filter expression interface to `dv work` that is independent of output format and supports adapter-owned policy expressions for selectable AFK work. Return a two-lane planning payload: deterministic `selectable` candidates that Sandcastle may choose and non-selectable `horizon` context that improves sequencing without making unsafe work actionable. Keep repository-specific transition and checklist mutation outside core `dv` code behind configurable Node-style scripts that can derive allowed state movement from the repository transition profile. Update authoritative documentation, regenerate Sandcastle prompt artifacts through template arguments, and prove the flow with end-to-end Sandcastle smoke coverage including interrupted and recoverable partial state.

## Coverage Model

### Actors

- repository maintainer

- Sandcastle planner

- Sandcastle implementation agent

- runtime command author

- repository workflow author

- future package author

### Journey Stages

- command surface cleanup

- adapter initialization

- work filtering

- planner context construction

- claim and lock execution

- repository transition

- partial-state recovery

- documentation handoff

- end-to-end validation

### Concerns

- authoritative work selection

- backward-compatibility removal

- adapter locality

- runtime authority consistency

- repository customization

- planner quality

- AFK safety

- graph and scope semantics

- template regeneration

- testability

### Coverage Notes

- The MVP should make Sandcastle consume `dv` through a small adapter instead of embedding repository rules in prompts.

- Named reusable profiles can be deferred if the `dv4sandcastle` adapter owns policy expressions for this slice.

- Checkbox mutation is treated as one possible Markdown-format concern, not as the core progress protocol.

## User Stories

1. As a repository maintainer, I want `dv task` removed from the public command surface, so that Work remains the family-wide command name after the compatibility window.
   Covers: repository maintainer / command surface cleanup / backward-compatibility removal

2. As a Sandcastle planner, I want a `dv4sandcastle` list command backed by `dv work`, so that work selection uses Doc-Vader's authoritative Work and runtime facts instead of ad hoc Markdown parsing.
   Covers: Sandcastle planner / adapter initialization / authoritative work selection

3. As a Sandcastle implementation agent, I want `dv4sandcastle` view and prompt commands backed by `dv work show` and `dv work prompt`, so that implementation context comes from the same canonical model used for selection.
   Covers: Sandcastle implementation agent / adapter initialization / adapter locality

4. As a runtime command author, I want all Sandcastle claim management to flow through `dv` runtime commands, so that partial-state recovery uses the Git plus SQLite runtime authority instead of legacy JSON claim files.
   Covers: runtime command author / claim and lock execution / runtime authority consistency

5. As a repository workflow author, I want transition and checklist mutation to be script-configurable, so that a repository can change workflow commands without requiring changes to core `dv` code.
   Covers: repository workflow author / repository transition / repository customization

6. As a Sandcastle planner, I want deterministic selectable candidates plus non-selectable horizon context, so that I can reason about sequencing quality without being allowed to choose blocked, HITL, claimed, or unsafe work.
   Covers: Sandcastle planner / planner context construction / planner quality

7. As a repository maintainer, I want `dv work` filtering to be decoupled from output formatting, so that adapters can reuse the same selection policy with JSON, text, or future formats.
   Covers: repository maintainer / work filtering / authoritative work selection

8. As a Sandcastle implementation agent, I want recovery commands in the adapter flow, so that interrupted or dirty partial work is classified and recovered through `dv work recover` before new execution starts.
   Covers: Sandcastle implementation agent / partial-state recovery / AFK safety

9. As a future package author, I want nested and scoped dependency semantics represented through the Work graph and ScopeRef model rather than Markdown checkboxes, so that future entities can participate in AFK selection without copying Work Item body conventions.
   Covers: future package author / planner context construction / graph and scope semantics

10. As a repository maintainer, I want Sandcastle prompt artifacts regenerated from template arguments, so that plan and implementation prompts do not drift from the adapter contract.
   Covers: repository maintainer / documentation handoff / template regeneration

11. As a repository maintainer, I want authoritative docs that supersede completed backlog history, so that implementation agents use the current `dv work` and `dv4sandcastle` contract.
   Covers: repository maintainer / documentation handoff / AFK safety

12. As a repository maintainer, I want an end-to-end Sandcastle smoke covering selection, claim, lock, record, transition, release, and recovery, so that `dv` is proven Sandcastle-ready before dogfooding.
   Covers: repository maintainer / end-to-end validation / testability

## Coverage Review

Status: `complete`

The stories cover command cleanup, adapter wiring, native runtime usage, configurable transitions, two-lane planning context, filtering, graph/scope semantics, documentation, and end-to-end recovery validation. The coverage intentionally avoids hosted Sandcastle authority and upstream Sandcastle changes unless later required.

## Quality Review

- grounding: 5/5
  Rationale: Grounded in current CLI registration, Work command inventory, Sandcastle prompt artifacts, adapter implementation, runtime ADRs, and the conversation decisions.

- coverage: 5/5
  Rationale: The coverage model spans the full local Sandcastle lifecycle from selection through recovery instead of only adapter list/view/close behavior.

- decision-rationale: 5/5
  Rationale: Each major decision preserves the agreed authority model: Work Item canonicality, Git plus SQLite runtime authority, adapter locality, repository-customizable transitions, and deterministic AFK gates.

- testability: 4/5
  Rationale: Existing CLI and runtime tests provide strong seams, but true Sandcastle smoke coverage may need a new integration harness around generated `.sandcastle` artifacts.

- automation-readiness: 5/5
  Rationale: The PRD defines machine-readable filter, selectable/horizon, adapter, and recovery contracts suitable for AFK issue decomposition.

The PRD is ready for issue breakdown. The only intentionally deferred decision is named profile support; adapter-owned policy expressions are sufficient for the first vertical slice.

## Implementation Decisions

- Remove `task` from the public Work command aliases while keeping `work` canonical and `wi` as shorthand.
  Rationale: The compatibility period has ended; leaving `task` public keeps confusing Task subtype language with the Work family command surface.

  Category: `api-contract`

- Introduce a `dv4sandcastle` adapter module as the only Sandcastle issue-tracker adapter for this repository.
  Rationale: Sandcastle's built-in issue tracker contract is list/view/close-shaped, while Doc-Vader needs claim, lock, record, transition, release, and recovery semantics behind that small surface.

  Category: `module-boundary`

- Make `dv4sandcastle` a thin adapter over `dv work`, `dv claim`, `dv lock`, repository transition scripts, and recovery commands; do not let it own a claim store.
  Rationale: ADR-007 makes Git plus SQLite the local runtime authority, so adapter-local JSON claim state would reintroduce split-brain recovery behavior.

  Category: `architecture`

- Wire Sandcastle prompt generation through InitService template arguments instead of maintaining hand-edited plan and implementation prompts.
  Rationale: The generated prompt files should be render artifacts of the adapter contract, otherwise prompt guidance drifts from the current `dv` command surface.

  Category: `interaction`

- Add a `dv work` filter expression interface that is independent of output format.
  Rationale: Selection policy and rendering format solve different problems; adapters need reusable deterministic filters without coupling them to JSON output.

  Category: `interface`

- Return Sandcastle planning data as selectable candidates plus horizon context.
  Rationale: A planner needs enough graph and dependency context to sequence well, but safety requires fresh deterministic validation before any item is actionable.

  Category: `api-contract`

- Keep repository-specific transition and checkbox mutation behind configurable Node-style scripts.
  Rationale: Repositories must be able to change lifecycle commands and Markdown conventions without requiring core `dv` code changes; checkboxes are a Markdown format concern, not the core agent progress protocol.

  Category: `interface`

- Use graph relationships, dependency state, scopes, records, and runtime findings as the agent-native progress model.
  Rationale: This matches the value of Beads-style dependency and nested task behavior without copying a Beads-specific ID model or tying Doc-Vader to checkboxes.

  Category: `architecture`

- Update authoritative ADR/how-to documentation rather than treating completed backlog items as current guidance.
  Rationale: Completed backlog work captures history; implementation agents need a current contract that supersedes old `dv task` and JSON claim-store language.

  Category: `technical-clarification`

- Prove readiness with an end-to-end Sandcastle smoke that includes interrupted and recoverable execution.
  Rationale: The system is not Sandcastle-ready until adapter initialization, selection, claim, lock, record, transition, release, and recovery succeed together.

  Category: `interaction`

## Testing Decisions

Validate that Sandcastle consumes `dv` through `dv4sandcastle`, that `dv work` is the only public Work family command surface, that selection returns deterministic selectable work plus horizon context, that adapter claim and recovery paths use SQLite runtime authority, and that repository-specific transition behavior is script-configurable without core CLI changes.

### Modules Under Test

- Work command inventory and CLI help surface

- dv4sandcastle adapter module

- Work filter expression evaluator

- Sandcastle template argument wiring

- repository transition script contract

- runtime claim, lock, record, release, and recovery flow

- Sandcastle smoke harness

### Test Seams

- Work command CLI parity (`end-to-end`): Existing command parity tests already exercise CLI help and alias behavior at the public seam.

  Prior art:

  - tests/work-command-parity.test.ts

  - tests/work-graph-uac-review.test.ts

- Runtime command flow (`integration`): Claims, locks, records, and recovery must be validated through the runtime authority rather than isolated helper functions.

  Prior art:

  - tests/task-command.test.ts

  - tests/claim-command.test.ts

  - tests/runtime-sqlite-store.test.ts

- Sandcastle adapter contract (`integration`): The adapter must translate Sandcastle list/view/close expectations into `dv` commands and repository scripts without owning policy state.

  Prior art:

  - tests/sandcastle-claim-release.test.ts

  - scripts/sandcastle/dv-adapter.ts

- Sandcastle smoke (`end-to-end`): Full readiness requires the generated Sandcastle scaffold and adapter to execute the same flow an AFK agent will use.

  Prior art:

  - .sandcastle/main.ts

  - .sandcastle/VALIDATION.md

### Prior Art

- Existing Work command inventory and alias parity tests.

- Existing graph-backed Work list, show, ready, prompt, and status tests.

- Existing runtime SQLite store and claim command tests.

- Existing Sandcastle claim release messaging tests.

- Existing PRD validate/render CLI for durable planning artifacts.

### Validation Gates

- doc-vader prd validate on this PRD content payload

- doc-vader prd render for the Markdown view

- pnpm run docs:lint before and after documentation changes

- pnpm run backlog:validate after backlog issue creation

- pnpm run backlog:validate:ci before final handoff after backlog issue creation

- pnpm run typecheck

- focused Vitest suites for Work command, runtime command, adapter, and Sandcastle smoke behavior

### Seam Review

Status: `confirmed`

The highest practical seams are CLI/integration seams because the behavior is valuable only when command registration, generated prompts, runtime persistence, and repository scripts compose correctly.

## Success Criteria

- `dv work` and `dv wi` expose the Work family command surface and `dv task` is no longer public.

- `dv4sandcastle` provides Sandcastle-compatible list, view, prompt, claim, record, transition/close, release, and recovery behavior over `dv`-native commands.

- The adapter no longer reads or writes the legacy JSON task-claim store.

- Sandcastle prompt artifacts are generated from InitService template arguments and no longer encode stale ad hoc list/view scripts or direct completion edits.

- `dv work` supports filter expressions decoupled from output format.

- Sandcastle receives selectable candidates plus horizon context, and chosen work is revalidated before claim.

- Repository workflow transitions are configurable through scripts and transition-profile-derived validation rather than core CLI code changes.

- Authoritative docs describe the current `dv work` plus `dv4sandcastle` contract and supersede old completed backlog guidance.

- An end-to-end Sandcastle smoke verifies selection, claim, lock, record, transition/release, and partial-state recovery.

## Out of Scope

- Upstream Sandcastle changes unless local adapter/templateArgs support proves insufficient.

- Hosted runtime authority.

- Multi-repository runtime coordination.

- A general named profile system before adapter-owned policy expressions prove the need.

- A checkbox-specific core `dv mark` command.

- Copying Beads' dotted ID model into Doc-Vader's canonical identity model.

- Replacing the Work Item schema or changing all historical backlog terminology.

- Finalizing or archiving existing completed backlog history.

## Agent Handoff

Ready label: `ready-for-agent`

- Create AFK slices in dependency order as vertical Sandcastle command-surface tracer bullets, not horizontal implementation layers.

- Slice 1: Sandcastle planning list surface. Deliver `dv4sandcastle list` as the Sandcastle `LIST_TASKS_COMMAND`, backed by `dv work` filtering and selectable/horizon output. Include removal of public `dv task` compatibility only insofar as the list surface proves Sandcastle now enters through `dv work`.

- Slice 2: Sandcastle work inspection surface. Deliver `dv4sandcastle view` and `dv4sandcastle prompt` as the Sandcastle inspection contract, backed by `dv work show` and `dv work prompt`, with no ad hoc Markdown parser.

- Slice 3: Sandcastle claim and recovery surface. Deliver `dv4sandcastle claim`, lock guidance/verification, release, and recover commands over `dv` runtime authority, with no legacy JSON claim store.

- Slice 4: Sandcastle close and repository transition surface. Deliver `dv4sandcastle close`/terminal handling through configurable repository scripts plus `dv` evidence, lock, transition-profile validation, and runtime release semantics.

- Slice 5: Regenerate Sandcastle templateArgs and prompt wiring so generated artifacts call the four adapter surfaces.

- Slice 6: Update authoritative documentation for the current `dv work` plus `dv4sandcastle` contract.

- Slice 7: Add end-to-end Sandcastle smoke and partial-state recovery coverage over the generated scaffold.

- Use `dv work` and `dv wi` language in new work items; mention `dv task` only as removed legacy compatibility.

- Treat checkbox mutation as repository script behavior, not core runtime protocol.

- Keep each slice independently verifiable through CLI or integration tests.

## Further Notes

- The Beads comparison supports graph-native readiness and close semantics, but Doc-Vader should express the equivalent value through Work graph relationships, ScopeRefs, records, and runtime gates rather than adopting Beads-specific dotted IDs.

- Planner quality should be protected with horizon context rather than by making unsafe work selectable.

- The `dv4sandcastle` adapter can hold policy expressions initially; named reusable filter profiles should wait until repeated non-Sandcastle consumers need them.
