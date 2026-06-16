# TASK

Fix issue {{TASK_ID}}: {{ISSUE_TITLE}}

First claim the task:

`CI=true pnpm exec tsx scripts/sandcastle/dv-adapter.ts claim {{TASK_ID}} --holder sandcastle --branch {{BRANCH}} --json`

Save the returned `claimId`. Use that exact claim for evidence recording. Do not release it after successful implementation; the merger closes the task with this active claim and releases it after close.

Pull in the issue using `CI=true pnpm exec tsx scripts/sandcastle/dv-adapter.ts view {{TASK_ID}}`. If the task has a parent PRD, pull that in too.

Load the implementation prompt rendered from the same task JSON:

`CI=true pnpm exec tsx scripts/sandcastle/dv-adapter.ts prompt {{TASK_ID}}`

Only work on the claimed task. If claim, view, or prompt fails, stop.

Work on branch {{BRANCH}}. Make commits and run tests.

# CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# EXPLORATION

Explore the repo and fill your context window with relevant information that will allow you to complete the task.

Pay extra attention to test files that touch the relevant parts of the code.

# EXECUTION

If applicable, use RGR to complete the task.

1. RED: write one test
2. GREEN: write the implementation to pass that test
3. REPEAT until done
4. REFACTOR the code

# FEEDBACK LOOPS

Before committing, run validation with heartbeat output so Sandcastle can distinguish long-running validation from an idle agent:

```sh
CI=true scripts/sandcastle/run-with-heartbeat.sh typecheck pnpm run typecheck
CI=true scripts/sandcastle/run-with-heartbeat.sh test pnpm run test
```

# EVIDENCE AND CLAIM HANDOFF

After implementation and validation, record evidence using the saved `claimId`.

Create an evidence payload:

```sh
cat > /tmp/doc-vader-evidence.json <<'JSON'
{
  "type": "test-result",
  "summary": "Sandcastle task validation passed",
  "observation": "Implementation completed and required validation commands passed.",
  "outcome": "pass"
}
JSON
```

Record evidence:

`CI=true pnpm exec tsx scripts/sandcastle/dv-adapter.ts record --claim <claimId> --payload /tmp/doc-vader-evidence.json`

Keep the claim active after evidence is recorded. The merge phase uses the active claim as the mutex guard when closing the task.

If the task is abandoned or cannot be completed, release the claim before stopping:

`CI=true pnpm exec tsx scripts/sandcastle/dv-adapter.ts release --claim <claimId>`

# COMMIT

Make a git commit. The commit message must:

1. Use the repository conventional commit format, such as `feat(scope): summary`, `fix(scope): summary`, `test(scope): summary`, or `docs(scope): summary`
2. Include task completed + PRD reference in the commit body when applicable
3. Include key decisions made
4. Include files changed
5. Include blockers or notes for next iteration

Keep it concise.

# THE ISSUE

If the task is not complete, leave a comment on the issue with what was done.

Do not close the issue - this will be done later.

Once complete, output <promise>COMPLETE</promise>.

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
