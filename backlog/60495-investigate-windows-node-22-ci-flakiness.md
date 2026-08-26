---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60495
title: Investigate Windows Node 22 CI Flakiness
summary: Reproduce, diagnose, and stabilize the intermittent required Windows Node 22 CI test failure observed while merging PR #81.
type: work-item
subtype: bug
lifecycle: active
status: ready
priority: high
estimated: 3
links:
  reference:
    - 'https://github.com/calan-co/doc-vader/pull/81'
    - 'https://github.com/calan-co/doc-vader/actions/runs/98255894389'
    - 'https://github.com/calan-co/doc-vader/actions/runs/32933842522'
tags:
  - ci
  - windows
  - node-22
  - flakiness
  - github-actions
---

## Goal

Establish a deterministic, Windows-representative feedback loop for the repeated
Node 22 test failure and deliver an evidence-backed stabilization without
weakening required CI or protected-branch policy.

## Background

The required `ci / Test (Node 22, windows-latest)` job failed repeatedly while
PR #81 was awaiting merge. GitHub job `98255894389` captured a failing instance;
a subsequent rerun passed and allowed PR #81 to merge. That passing rerun is
validation evidence, not proof that the defect is fixed.

The affected automation is consumed through the `GitHubBacklogAutomationProvider`
adapter. This investigation must preserve that provider contract and must not
change CI, workflow, branch-protection, or merge/rerun configuration merely to
avoid the failure.

Dependency review: no existing active Work Item establishes a direct,
resolvable prerequisite for this investigation. The work may begin independently
and must record any newly discovered dependency before relying on it.

## Tasks

- [ ] Capture the exact failed-job logs, test name(s), runner image, Node version,
  timing, and rerun evidence for job `98255894389`.
- [ ] Build and run a tight, agent-runnable Windows-representative feedback loop
  that can detect the reported failure; raise its reproduction rate if the
  failure is nondeterministic.
- [ ] Minimize the reproducer and record ranked, falsifiable hypotheses before
  changing production code or workflow configuration.
- [ ] Add a focused failing regression test at the correct seam, implement the
  smallest stabilization, and re-run the original reproduction loop.
- [ ] Validate the fix on Node 22 Windows and relevant cross-platform CI without
  weakening required checks, masking failures, or changing branch protection.

## Deliverables

- Failed and succeeding-rerun evidence with a minimized reproduction record.
- A focused regression test and the smallest evidence-backed stabilization.
- A validation report identifying the root cause or, if unreproduced, the
  measured reproduction rate and next falsifiable diagnostic step.

## Acceptance Criteria

- [ ] The failed Windows Node 22 job `98255894389` and its succeeding rerun are
  linked as evidence and distinguish observed recovery from a verified fix.
- [ ] A deterministic or measured-high-reproduction agent-runnable feedback loop
  exercises the reported Windows Node 22 failure path.
- [ ] A focused regression test fails before the fix and passes after it at the
  real failure seam.
- [ ] Required Node 22 Windows and relevant cross-platform CI pass without
  removing, skipping, weakening, or bypassing CI/protection policy.
- [ ] The final evidence records the root cause, validation commands/results,
  residual flake risk, and rollback signal.
