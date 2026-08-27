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
  pull_requests:
    - "https://github.com/calan-co/doc-vader/pull/81"
  reference:
    - "https://github.com/calan-co/doc-vader/actions/runs/32993179106/job/98255894389"
    - "https://github.com/calan-co/doc-vader/actions/runs/32933842522/job/98231508726"
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

The required `ci / Test (Node 22, windows-latest)` job failed while PR #81
was awaiting merge. GitHub job `98255894389` captured a failing instance. A
separate successful Windows Node 22 attempt was later observed, but it is not a
rerun of the failed run or SHA; it is comparison evidence, not proof that the
defect is fixed.

The affected automation is consumed through the `GitHubBacklogAutomationProvider`
adapter. This investigation must preserve that provider contract and must not
change CI, workflow, branch-protection, or merge/rerun configuration merely to
avoid the failure.

Dependency review: no existing active Work Item establishes a direct,
resolvable prerequisite for this investigation. The work may begin independently
and must record any newly discovered dependency before relying on it.

## Evidence Snapshot

### Failed required job

- Run/job: [`32993179106` / `98255894389`](https://github.com/calan-co/doc-vader/actions/runs/32993179106/job/98255894389)
- Commit: `067dff5736754438e1bf8185096c26a9dacebfb1` (`staging` push, attempt `1`)
- Result: failure; GitHub-hosted runner `GitHub Actions 1000005737`, runner group
  `GitHub Actions`; Windows Server 2025 (`10.0.26100`, Datacenter)
- Runner image: `windows-2025-vs2026`, version `20260818.207.1`; hosted-compute
  agent version `20260729.566`
- Resolved Node: `v22.23.2` (`C:\hostedtoolcache\windows\node\22.23.2\x64`)
- Lockfile SHA-256: `1c5175f1263bcb0923d51ccad1cf7f0be8be2ff81b885e90c9e9388fea6c8e70`
- Raw failure excerpts:
  - `tests/task-command.test.ts:3478:3` — `selects ready tasks and reports
structured deterministic exclusions`; `Error: Test timed out in 15000ms.`
    (reported elapsed `15100ms`)
  - `tests/task-command.test.ts:3779:3` — `only returns ready candidates that
can be claimed in the same context`; `Error: Test timed out in 5000ms.`
    (reported elapsed `5100ms`)
- Suite summary: `1 failed | 62 passed` test files; `2 failed | 505 passed | 2
skipped` tests; duration `227.27s` (tests `561.48s`).

### Successful comparison job

- Run/job: [`32933842522` / `98231508726`](https://github.com/calan-co/doc-vader/actions/runs/32933842522/job/98231508726)
- Commit: `6a1c7e66c61c29ec6cb505a02d5bd799a7ed98c5`
  (`salvage/permanent-review-delivery-debt-workitems`, attempt `2`)
- Result: success; GitHub-hosted runner `GitHub Actions 1000005692`, runner group
  `GitHub Actions`; Windows Server 2025, image `windows-2025-vs2026` version
  `20260818.207.1`, hosted-compute agent version `20260729.566`
- Resolved Node: `v22.23.2`; suite summary: `63 passed` test files and `507
passed | 2 skipped` tests.

The successful job has the same recorded lockfile SHA-256 as the failed commit,
but it is a different commit and run. GitHub did not expose a successful rerun
of run `32993179106` in the evidence reviewed here; this Work Item must not
label the comparison job as that rerun.

## Windows Node 22 Probe Contract

Run this contract on a clean GitHub-hosted Windows Server 2025 / Node `22.23.2`
runner, checked out at failed SHA `067dff5736754438e1bf8185096c26a9dacebfb1`.
It is a diagnostic contract, not a change to required CI, branch protection,
or merge policy and not a root-cause claim. The bounded execution surface is
[`.github/workflows/windows-node22-diagnostic.yml`](../.github/workflows/windows-node22-diagnostic.yml):
manual dispatch only, fixed to the failed SHA, and separate from the required
CI workflow. Its only dispatch input is an integer from `1` through `30`; it
records the selected bounded iteration count with every result.

### Isolation and cache policy

Each iteration uses a distinct, disposable checkout and a distinct pnpm store;
it must not share `node_modules`, temporary roots, runtime SQLite state, Git
worktrees, or pnpm store with another iteration. `cold` means the checkout and
pnpm store are newly created before `pnpm install --frozen-lockfile`; `warm`
means the same isolated checkout/store immediately runs the same command a
second time without reinstalling. Do not mix cold and warm samples or reuse a
workspace across concurrent processes.

For each isolated checkout, run the CI-equivalent setup before the probe:

```powershell
$ErrorActionPreference = 'Stop'
git checkout --detach 067dff5736754438e1bf8185096c26a9dacebfb1
git clean -ffdx
pnpm install --frozen-lockfile --store-dir "$env:RUN_ROOT\pnpm-store-$env:ITERATION"
pnpm run build
```

The CI-equivalent full-suite baseline preserves the CI build-before-test
sequence, Node major, frozen lockfile, and `pnpm run test -- --run` entry point,
while explicitly fixing the diagnostic worker count at four:

```powershell
pnpm run build
pnpm run test -- --run --pool=forks --minWorkers=4 --maxWorkers=4 --reporter=verbose
```

The controlled focused command exercises the two affected tests only:

```powershell
pnpm exec vitest run tests/task-command.test.ts `
  -t "selects ready tasks and reports structured deterministic exclusions|only returns ready candidates that can be claimed in the same context" `
  --pool=forks --minWorkers=1 --maxWorkers=1 --no-file-parallelism --reporter=verbose
```

### Required runs

1. Run **30 cold four-worker full-suite baselines** in fresh isolated checkouts
   using the CI-equivalent command above; then run one warm repeat in each
   checkout.
2. Run **30 cold serial focused** iterations with the focused command above.
3. Run **30 cold two-process focused waves**. For each wave, create two isolated
   checkouts, complete setup in each, and start one focused command in each
   process simultaneously; wait for both before beginning the next wave.
4. Run **30 cold four-process focused waves** with four separately prepared
   checkouts and simultaneous focused commands; wait for all four before the
   next wave.

The two- and four-process waves use the one-worker focused command once per
isolated checkout. PowerShell orchestration must preserve each process exit code
and redirect its complete stdout/stderr to that iteration's evidence file; it
must not share a checkout or pnpm store between wave members. The manual probe
plans all requested iterations, but stops before its 330-minute execution budget
would be exceeded, writes an explicit incomplete summary, and never treats a
partial plan as a clean result.

### Telemetry and outcome thresholds

For every cold and warm sample, record: iteration/wave/member identifier; start
and end timestamps; exit code; complete stdout and stderr; the test-result and
per-test durations; `node --version`, `pnpm --version`, `git --version`, and
`git rev-parse HEAD`; Windows product/build; runner image/version when supplied
by the runner; `Get-FileHash pnpm-lock.yaml -Algorithm SHA256`; effective Vitest
options; cold/warm state; workspace path; and pnpm-store path. Retain logs even
when the sample passes. Every sample manifest includes the collected runtime
telemetry. Artifact workspaces exclude `.git` and the workflow disables persisted
checkout credentials; subject identity is recorded from the verified approved
SHA rather than copied Git metadata.

- Any timeout, non-zero exit, or matching failed test is a reproduction and
  records the observed rate by run class; preserve its raw output before any
  follow-up.
- Record planned, executed, failed, and timed-out counts/rates for every
  phase/cold-warm class. If the execution budget prevents all planned samples,
  mark that class and the probe incomplete.
- If no failures occur in a run class after 30 cold samples, record `0/30` for
  that class rather than calling it stable or fixed.
- Compare rates and duration distributions only after all four classes complete.
  A materially higher rate or latency in a concurrent class is evidence for a
  next diagnostic probe, not a root-cause conclusion.
- If runner-image, resolved-version, or complete log capture is unavailable,
  record it as unavailable for that sample; do not substitute inferred values.

## Tasks

- [ ] Preserve independently accessible failed and successful comparison evidence,
      including job/run IDs, SHA, runner image, Node version, raw timeout excerpts,
      and the comparison caveat above.
- [ ] Run the defined Windows Node 22 probe contract from the failed SHA: the
      four-worker baseline, serial repetitions, and isolated two- and four-process
      waves. Record the specified telemetry and apply its outcome thresholds.
- [ ] Build a tight, agent-runnable Windows-representative feedback loop that can
      detect the reported failure; raise its reproduction rate if the failure is
      nondeterministic.
- [ ] Minimize the reproducer and record ranked, falsifiable hypotheses before
      changing production code or workflow configuration.
- [ ] Add a focused failing regression test at the correct seam, implement the
      smallest stabilization, and re-run the original reproduction loop.
- [ ] Validate the fix on Node 22 Windows and relevant cross-platform CI without
      weakening required checks, masking failures, or changing branch protection.

## Deliverables

- Failed and successful-comparison evidence with a minimized reproduction record.
- A recorded Windows Node 22 probe result with its reproduction rate, telemetry,
  and outcome decision.
- A focused regression test and the smallest evidence-backed stabilization.
- A validation report identifying the root cause or, if unreproduced, the
  measured reproduction rate and next falsifiable diagnostic step.

## Acceptance Criteria

- [ ] The failed Windows Node 22 job `98255894389` and the separately successful
      comparison job are linked with their exact run/job IDs, SHAs, environment
      facts, raw timeout excerpts, and the distinction between comparison evidence
      and a verified rerun/fix.
- [ ] The probe contract records its baseline and serial/wave outcomes against
      the stated thresholds before a cause or stabilization is claimed.
- [ ] A deterministic or measured-high-reproduction agent-runnable feedback loop
      exercises the reported Windows Node 22 failure path.
- [ ] A focused regression test fails before the fix and passes after it at the
      real failure seam.
- [ ] Required Node 22 Windows and relevant cross-platform CI pass without
      removing, skipping, weakening, or bypassing CI/protection policy.
- [ ] The final evidence records the root cause, validation commands/results,
      residual flake risk, and rollback signal.
