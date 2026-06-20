# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
3. After resolving conflicts, run `CI=true scripts/sandcastle/run-with-heartbeat.sh typecheck pnpm run typecheck` and `CI=true scripts/sandcastle/run-with-heartbeat.sh test pnpm run test` to verify everything works
4. If tests fail, fix the issues before proceeding to the next branch

After all branches are merged, run:

```sh
CI=true scripts/sandcastle/run-with-heartbeat.sh docs:lint pnpm run docs:lint
CI=true scripts/sandcastle/run-with-heartbeat.sh backlog:validate pnpm run backlog:validate
CI=true scripts/sandcastle/run-with-heartbeat.sh backlog:validate:ci pnpm run backlog:validate:ci
CI=true scripts/sandcastle/run-with-heartbeat.sh test pnpm run test
```

Make a single conventional commit summarizing the merge.

# CLOSE ISSUES

For each branch that was merged, close its issue only after validation passes and the temporary completion protocol is satisfied.

Before running `close-task` for a task:

1. Open the work item Markdown file for `<TASK_ID>`.
2. Confirm every required checklist item under `## Tasks`, `## Deliverables`, `## Acceptance Criteria`, `## Acceptance criteria`, or similarly named checklist sections is checked.
3. If a required checkbox is unchecked but the merged branch provides concrete evidence, check it in the work item before closing.
4. If a required checkbox remains unchecked or only partially satisfied, do not close that task. Leave the claim active only if more work will continue immediately; otherwise report the blocker and release the claim.
5. Confirm the work item has linked evidence from `dv task record`.
6. Confirm the final validation commands above passed after all merges and checklist edits.

The command below reuses the existing active implementation claim for the task, closes the task, then releases that claim. Replace `<TASK_ID>` with the issue id from the list below and `<EFFORT>` with the actual effort hours as a number:

`CI=true TMPDIR=/tmp node --import tsx scripts/sandcastle/dv-adapter.ts close-task <TASK_ID> --actual <EFFORT>`

Here are all the issues:

{{ISSUES}}

Once you've merged everything you can, output <promise>COMPLETE</promise>.
