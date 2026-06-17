---
id: wi-60354
title: Canonical Task Model Show and Prompt
summary: Implement canonical task JSON plus templjs-rendered task prompt output so Sandcastle receives stable machine context and deterministic execution guidance from the same source model.
type: work-item
subtype: story
lifecycle: active
status: ready
status_reason: auto
priority: critical
estimated: 5
links:
  reference:
    - '[[60339-agent-command-surface-for-skills-and-sandcastle]]'
    - '[[60341-task-ready-afk-eligibility-query]]'
  evidence:
    - '[[record-20260616-043441-60354]]'
    - '[[task-record-preflight]]'
    - '[[record-sandcastle-task-validation-passed]]'
tags:
  - afk
  - sandcastle
  - dogfood
  - command-surface
  - task-cli
---

## Parent

[Sandcastle Dogfood Command Surface PRD](../docs/how-to/implementation-plans/sandcastle-dogfood-command-surface-prd.md)

## What to build

Add a canonical task model that loads one work item into stable JSON for automation, then render human and Sandcastle prompt views from that same JSON. `dv task show <task-id> --json` is the authoritative context contract; `dv task show <task-id>` and `dv task prompt <task-id>` are templjs-rendered views over the same model.

## Acceptance criteria

- [x] `dv task show <task-id> --json` returns a deterministic task object with id, title, file path, status, lifecycle, tags, dependencies, body sections, acceptance criteria, and validation-relevant metadata.
- [x] `dv task show <task-id>` renders a human-readable view from the same task JSON without re-parsing divergent state.
- [x] `dv task prompt <task-id>` renders a Sandcastle-oriented templjs prompt from the same authoritative task JSON.
- [x] Missing, ambiguous, archived, or invalid task ids fail with structured errors and non-zero exit codes.
- [x] Templjs rendering is limited to presentation; eligibility, claim state, dependency, and validation decisions remain in code.
- [x] Tests cover JSON output stability, prompt rendering, missing task behavior, and no-drift reuse of the canonical task model.

## Blocked by

None - can start immediately.
