---
$schema: schemas/work-management/frontmatter/prd.json
$content_schema: schemas/work-management/content/prd.json
$template: templates/reference/work-management/prd.md.tpl
id: plan:sandcastle-dogfood-command-surface-prd
title: Sandcastle Dogfood Command Surface PRD
summary: Minimal fail-closed dv task command surface for safely dogfooding Doc-Vader improvements with Sandcastle.
type: plan
subtype: x-prd
lifecycle: active
status: ready
tags:
  - ready-for-agent
  - sandcastle
  - dogfood
---

## Artifact Strategy

- Source of truth: `json-payload`
- Rendered views: `markdown`
- Preservation: Store this content JSON sidecar next to the rendered Markdown PRD and treat the JSON as canonical for automation.

## Context Grounding

Doc-Vader currently has backlog validation, work-item mutation, record creation, PRD validation/rendering, and a library-level AFK eligibility helper. It does not yet expose the Sandcastle-facing `dv task` command surface needed for deterministic dogfooding. Active backlog items define the fuller architecture, but the minimum safe dogfood path should narrow scope to conservative ready selection, local claim locking, task view/prompt rendering, claim-aware evidence recording, and stop-before-close handoff.

### Domain Vocabulary

- Sandcastle

- dogfood loop

- dv task ready

- dv task show

- dv task prompt

- dv task claim

- dv task release

- dv task record --claim

- authoritative task JSON

- templjs render

- local claim lock

- AFK-ready

- HITL

- fail-closed

- claim-aware evidence

- stop-before-close

### ADR Alignment

No authoritative ADR was found for the minimal Sandcastle dogfood command surface. This PRD intentionally narrows the existing Sandcastle command-surface backlog to a safe local MVP and defers hosted authority, immutable scope graphs, artifact reservations, and revocation semantics.

### Source Context

- Conversation decision: initial Sandcastle dogfooding should use a conservative single-agent fail-closed path rather than waiting for the full claim/scope architecture.

- Conversation decision: `dv task prompt` renders a templjs prompt from the same authoritative task JSON used by `dv task show --json`.

- Conversation decision: `dv task record --claim` is part of the minimum path and should use `--payload` JSON as the primary MVP interface, including stdin support.

- Current CLI surface in `cli/doc-vader.ts` exposes backlog, work-item, record, and prd domains, but not a task domain.

- Current helper in `lib/backlog/backlog.ts` filters AFK-ready candidates by active ready work-item status and tags, but does not expose command-level runtime gates or claim awareness.

- Existing backlog records 60341 through 60346 describe the fuller Sandcastle command surface.

## Problem Statement

The maintainer wants to use Sandcastle to improve Doc-Vader itself, but the current command surface is not yet deterministic enough for safe agent selection and workflow. Without a minimal `dv task` surface, Sandcastle would need inline scripts or manual file edits for selection, claiming, task context, and evidence linking, which would bypass repository guardrails and make dogfooding unsafe.

## Solution

Deliver a narrow Sandcastle dogfood MVP: deterministic AFK-ready selection, a simple local claim lock, task show/prompt rendering from canonical task JSON, claim-aware record creation through schema-validated payloads, and a documented stop-before-close workflow. This enables one Sandcastle agent at a time to select, claim, inspect, implement, validate, record evidence, and release work without needing the full immutable scope graph or hosted claim authority.

## Coverage Model

### Actors

- repository maintainer

- Sandcastle planner

- implementation agent

- review or merge agent

### Journey Stages

- ready selection

- claim acquisition

- task context rendering

- implementation execution

- evidence recording

- handoff and release

### Concerns

- deterministic selection

- fail-closed safety

- no hand-edited backlog state

- template determinism

- parallelizable implementation

- minimal scope

### Coverage Notes

The coverage model targets safe local dogfooding, not full multi-agent production coordination.

## User Stories

1. As a Sandcastle planner, I want `dv task ready --json` to return only AFK-ready work with structured exclusion reasons, so that Sandcastle never starts HITL, invalid, dependency-blocked, or already claimed work.
   Covers: Sandcastle planner / ready selection / deterministic selection

2. As a repository maintainer, I want a simple local claim lock before Sandcastle edits files, so that dogfooding prevents duplicate local agents from selecting the same task without waiting for hosted claim authority.
   Covers: repository maintainer / claim acquisition / fail-closed safety

3. As an implementation agent, I want `dv task show --json` and `dv task prompt` to use the same authoritative task JSON, so that machine selection and human-readable execution context cannot drift.
   Covers: implementation agent / task context rendering / template determinism

4. As an implementation agent, I want `dv task record --claim --payload` to create and link evidence through one validated command, so that Sandcastle does not hand-edit backlog or record files.
   Covers: implementation agent / evidence recording / no hand-edited backlog state

5. As a review or merge agent, I want the dogfood flow to stop before close unless validation and evidence are recorded, so that early Sandcastle use cannot bypass existing close/finalize gates.
   Covers: review or merge agent / handoff and release / minimal scope

6. As a repository maintainer, I want the dogfood MVP decomposed into parallelizable vertical slices, so that agents can converge on a safe Sandcastle integration point efficiently.
   Covers: repository maintainer / implementation execution / parallelizable implementation

## Coverage Review

Status: `complete`

Stories cover selection, claim, context rendering, evidence recording, handoff, and implementation parallelization for the safe local dogfood path.

## Quality Review

- grounding: 5/5
  Rationale: The PRD is grounded in the current CLI/library surface, active Sandcastle backlog items, and explicit conversation decisions.

- coverage: 5/5
  Rationale: The coverage model targets every stage needed for safe local dogfooding while naming excluded production concerns.

- decision-rationale: 5/5
  Rationale: Each durable decision explains why the MVP favors simple local safety over the full coordination architecture.

- testability: 5/5
  Rationale: The required behavior can be tested at CLI and integration seams with existing Vitest and command execution patterns.

- automation-readiness: 5/5
  Rationale: The MVP requires stable JSON output/input contracts and uses templjs only for rendering from authoritative JSON.

The PRD is intentionally small enough for immediate agent execution while preserving fail-closed invariants.

## Implementation Decisions

- Expose `dv task ready --json` as the first Sandcastle selection contract.
  Rationale: Sandcastle needs a stable command boundary rather than library-only helpers or inline scripts.

  Category: `api-contract`

- Use a simple local claim lock for the dogfood MVP instead of waiting for immutable scope graphs.
  Rationale: A conservative lock prevents duplicate local selection and unblocks dogfooding while deferring production-grade claim architecture.

  Category: `architecture`

- Add `dv task show --json` as the authoritative task context model and render `dv task prompt` from the same JSON.
  Rationale: Machine-readable task context and Sandcastle prompt text must not diverge; templjs should render but not decide policy.

  Category: `interface`

- Use templjs for human and prompt rendering only.
  Rationale: Templates shorten implementation and improve consistency, but eligibility, claim state, validation, and linking decisions must remain in code.

  Category: `technical-clarification`

- Include `dv task record --claim --payload` in the minimum dogfood surface.
  Rationale: Claim-aware evidence creation and linking removes brittle Sandcastle glue and avoids hand-editing backlog state.

  Category: `api-contract`

- Make JSON payload input the primary MVP interface for task records, including stdin support.
  Rationale: A single schema-validated payload is more deterministic for Sandcastle than a large set of repeated and nested CLI flags.

  Category: `schema`

- Stop before automatic close in the first dogfood milestone unless validation, evidence, and release behavior are complete.
  Rationale: Early Sandcastle use should improve implementation throughput without bypassing existing closure and review gates.

  Category: `interaction`

## Testing Decisions

The MVP is valid when the CLI can list exactly eligible AFK tasks, claim one with a local lock, render both JSON and templated prompt from one task model, record claim-linked evidence from a JSON payload, and release the claim while validation gates remain enforceable.

### Modules Under Test

- task command CLI group

- AFK ready selection query

- local claim lock store

- task JSON loader

- templjs task prompt renderer

- claim-aware record payload parser and linker

- Sandcastle command mapping

### Test Seams

- Task command CLI contract (`cli`): Sandcastle will call commands, so selection, show, prompt, claim, record, and release must be tested through the CLI boundary.

  Prior art:

  - Existing CLI command tests around backlog scan and work-management behavior.

  - Existing AFK eligibility unit coverage in `tests/backlog-afk-query.test.ts`.

- Dogfood lifecycle integration fixture (`integration`): A representative task must flow through ready, claim, show, prompt, record, validate, and release without hand-edited state.

- Record payload schema contract (`schema-contract`): `dv task record --claim --payload` should fail before writes when payloads are malformed or missing required evidence fields.

### Prior Art

- Existing backlog validation and scan test fixtures.

- Existing work-management record creation commands.

- Existing PRD templjs render path.

- Existing active Sandcastle command-surface backlog items.

### Validation Gates

- pnpm run docs:lint

- pnpm run backlog:validate

- pnpm run backlog:validate:ci

- pnpm run test

### Seam Review

Status: `confirmed`

The CLI seam is the highest useful seam because Sandcastle integrates through commands rather than in-process library calls.

## Success Criteria

- Sandcastle can call `dv task ready --json` and receive only safe AFK candidates.

- Sandcastle can claim one task locally and another claim attempt fails while the claim is active.

- `dv task show --json` and `dv task prompt` render from the same canonical task model.

- Sandcastle can call `dv task record --claim --payload` to create and link evidence without hand-editing backlog files.

- The dogfood flow has documented stop-before-close and release behavior.

- A representative integration fixture proves the command sequence works end to end.

## Out of Scope

- Hosted claim authority

- Immutable content-addressed scope graphs

- Claim-bound artifact reservations

- Escalated claim revocation

- Section-level or nested artifact claims

- Automatic close/finalize before the minimal evidence and validation flow is proven

- Linkity pruned-index resolver integration

- Multiple concurrent Sandcastle agents modifying overlapping files

## Agent Handoff

Ready label: `ready-for-agent`

- Implement the minimum dogfood surface before expanding to the full Sandcastle command architecture.

- Keep all selection and claim failures fail-closed.

- Use templjs only to render from authoritative JSON models.

- Prefer stable JSON command contracts over human-oriented flags for Sandcastle-facing APIs.

## Relationships

- targets: `work-item:60339` Note: Narrows the full Sandcastle command-surface plan to a safe dogfood MVP.

- depends_on: `work-item:60341` Note: Ready selection remains the first implementation dependency.

- depends_on: `work-item:60345` Note: Claim-aware evidence recording is included in the minimum dogfood path.

## Further Notes

- The first dogfood milestone should support one local Sandcastle agent at a time.

- Discrete CLI flags for record creation can be added later as sugar over the JSON payload contract.

- A future milestone can replace the local claim lock with the fuller scope graph and hosted-authority-ready claim model.
