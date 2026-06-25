# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Verify the branch already marks its issue complete in its own final commits.
   The backlog file for that issue must have:
   - `status: completed`
   - `status_reason: completed`
   - `completed_date`
   - no unchecked `[ ]` items in `## Tasks`
   - no unchecked `[ ]` items in `## Acceptance Criteria`
2. If that evidence is missing, do not merge that branch. Report that the
   branch must return to implementation.
3. Run `git merge <branch> --no-edit`.
4. If there are merge conflicts, resolve them intelligently by reading both
   sides and choosing the correct resolution.
5. After resolving conflicts, run the relevant gates from
   `.sandcastle/VALIDATION.md`; at minimum run `pnpm run typecheck` and
   `pnpm run test` to verify everything works.
6. If tests fail, fix the issues before proceeding to the next branch.

Here are all the issues:

{{ISSUES}}

Once you've merged everything you can, output <promise>COMPLETE</promise>.
