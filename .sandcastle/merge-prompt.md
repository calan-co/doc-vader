# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
3. After resolving conflicts, run `pnpm run typecheck` and `pnpm run test` to verify everything works
4. If tests fail, fix the issues before proceeding to the next branch

After all branches are merged, make a single commit summarizing the merge.

# CLOSE ISSUES

For each branch that was merged, close its issue only after validating completion evidence:

1. Confirm all implementation work is complete.
2. Mark `## Tasks` and `## Acceptance Criteria` checkboxes as `[x]` only when concrete implementation and verification evidence exists.
3. Run `pnpm run docs:lint`, `pnpm run backlog:validate`, `pnpm run backlog:validate:ci`, and `pnpm run test`.
4. Close the issue using the guarded Doc-Vader CLI command:

`node dist/cli/doc-vader.js work-item transition --id <ID> --status closed --reason completed --actual <EFFORT> --consumer-config .doc-vader/backlog-consumer.json`

If the close command reports unchecked completion criteria, do not work around it. Reopen the work, complete the missing scope or leave the issue unclosed with a note describing the remaining unchecked criteria.

Here are all the issues:

{{ISSUES}}

Once you've merged everything you can, output <promise>COMPLETE</promise>.
