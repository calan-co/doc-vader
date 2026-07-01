# TASK

Fix issue {{TASK_ID}}: {{ISSUE_TITLE}}

Pull in the issue using `node .sandcastle/view-issue.mjs {{TASK_ID}}`.
If it has a parent PRD, pull that in too.

Only work on the issue specified.

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

# COMPLETION EVIDENCE

Before outputting `<promise>COMPLETE</promise>`, update the task file for
`{{TASK_ID}}` on branch `{{BRANCH}}`:

1. Mark every completed item in `## Tasks` with `[x]`.
2. Mark every satisfied item in `## Acceptance Criteria` with `[x]`.
3. Set frontmatter `status: completed`.
4. Set frontmatter `status_reason: completed`.
5. Set `completed_date` to today's ISO date.
6. Commit this backlog update as the final commit on the feature branch.

Do not mark the task complete unless every task and acceptance criterion is
actually satisfied by the branch. If anything remains incomplete, leave it
unchecked, leave the status non-completed, explain the blocker, and do not emit
`<promise>COMPLETE</promise>`.

# FEEDBACK LOOPS

Before committing, run the validation gates in `.sandcastle/VALIDATION.md`.
At minimum, run `pnpm run typecheck` and `pnpm run test`.

# COMMIT

Make a git commit. The commit message must:

1. Use a conventional commit subject, e.g. `fix(scope): complete wi-12345 title`.
2. Include `RALPH:` task completed + PRD reference in the commit body.
3. Include key decisions made.
4. Include files changed.
5. Include blockers or notes for next iteration.

Keep it concise.

# THE ISSUE

If the task is not complete, leave a note in your final response with what was
done and what remains.

Once complete, output <promise>COMPLETE</promise>.

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
