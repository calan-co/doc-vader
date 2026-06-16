# ISSUES

Here are the open issues in the repo:

<issues-json>

!`CI=true pnpm exec tsx scripts/sandcastle/dv-adapter.ts list`

</issues-json>

The list above has already been filtered to issues ready for work. Its order is
the default deterministic priority order from `dv task ready --json`: higher
priority tasks appear before lower priority tasks, with stable tie-breaks.

# TASK

Analyze the open issues and build a dependency graph. For each issue, determine whether it **blocks** or **is blocked by** any other open issue.

Do not run shell commands or inspect repository files during planning. The
`issues-json` payload is the bounded authoritative input for this phase. Infer
dependency and overlap risk only from each issue's id, title, summary, priority,
tags, dependencies, references, file path, and body section excerpts.

An issue B is **blocked by** issue A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
- B's requirements depend on a decision or API shape that A will establish

An issue is **unblocked** if it has zero blocking dependencies on other open issues.

For each unblocked issue, assign a branch name using the exact format `sandcastle/issue-{id}` (no slug or other suffix). This must be deterministic so that re-planning the same issue always produces the same branch name and accumulated progress is preserved.

Within a priority group, the input order is canonical. Preserve that relative
order unless dependency or merge-conflict analysis shows a concrete reason to
defer or sequence an issue differently. If you reorder same-priority issues,
the reason must be visible in your own reasoning before emitting the final plan;
do not reorder same-priority issues for convenience or preference.

# OUTPUT

Output your plan as a JSON object wrapped in `<plan>` tags:

<plan>
{"issues": [{"id": "42", "title": "Fix auth bug", "branch": "sandcastle/issue-42"}]}
</plan>

Include only unblocked issues. If every issue is blocked, include the single highest-priority candidate (the one with the fewest or weakest dependencies).

Always emit the `<plan>` tags, even when there is nothing to do. If there are no issues to work on at all, output `<plan>{"issues": []}</plan>` so the run can exit cleanly.
