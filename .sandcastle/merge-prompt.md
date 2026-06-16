# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
3. After resolving conflicts, run `pnpm run typecheck` and `pnpm run test` to verify everything works
4. If tests fail, fix the issues before proceeding to the next branch

After all branches are merged, run `pnpm run docs:lint`, `pnpm run backlog:validate`, `pnpm run backlog:validate:ci`, and `pnpm run test`.

Make a single commit summarizing the merge.

# CLOSE ISSUES

For each branch that was merged, close its issue only after validation passes. The command below reuses the existing active implementation claim for the task, closes the task, then releases that claim. Replace `<TASK_ID>` with the issue id from the list below and `<EFFORT>` with the actual effort hours as a number:

`pnpm exec tsx scripts/sandcastle/dv-adapter.ts close-task <TASK_ID> --actual <EFFORT>`

Here are all the issues:

{{ISSUES}}

Once you've merged everything you can, output <promise>COMPLETE</promise>.
