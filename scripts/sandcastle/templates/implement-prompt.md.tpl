# TASK

Fix issue {{TASK_ID}}: {{ISSUE_TITLE}}

Pull in the issue using `{{VIEW_TASK_COMMAND}} {{TASK_ID}}`.
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

# ADAPTER CONTRACT

Use the `dv4sandcastle` adapter surfaces instead of ad hoc helper scripts or
manual completion edits.

1. Inspect the canonical work item JSON with `{{VIEW_TASK_COMMAND}} {{TASK_ID}}`.
2. Render the authoritative implementation context with `{{PROMPT_TASK_COMMAND}} {{TASK_ID}}`.
3. Claim the task before editing with `{{CLAIM_TASK_COMMAND}} {{TASK_ID}} --holder <holder> --branch {{BRANCH}} --json`.
4. Check or explain runtime lock ownership with `{{LOCK_STATUS_COMMAND}} --claim <claim-id> --json`, and recover interrupted work with `{{RECOVER_TASK_COMMAND}} {{TASK_ID}} --branch {{BRANCH}} --json`.
5. Update task and acceptance checkboxes only when concrete branch evidence satisfies them, but leave status/completion transitions and evidence-link creation to the adapter close flow.
6. After validation passes, close through `{{CLOSE_TASK_COMMAND}} {{TASK_ID}} --claim <claim-id> [--payload <json-file>] [--record-type <type>]` so repository-configured transition behavior, evidence recording, and runtime release stay aligned.
7. When the close flow succeeds, keep the resulting backlog/status update as the final commit on the feature branch.
8. Do not edit backlog status/checklists by hand as the normal completion path.

If a close attempt fails after evidence or transition planning, treat the work
item as recoverable and use the adapter recovery surface before retrying.

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
