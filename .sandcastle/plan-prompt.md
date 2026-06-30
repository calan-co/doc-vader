# ISSUES

Here are the open issues in the repo:

<issues-json>

!`node --import tsx scripts/sandcastle/dv4sandcastle.ts list`

</issues-json>

The list above has already been filtered through Sandcastle's local fail-closed
backlog scan. It excludes HITL work, missing or invalid AFK classification,
unsatisfied dependencies, closed items, and archived items.

Do not run shell commands or inspect repository files during planning. The
`issues-json` payload is the bounded authoritative input for this phase.

# TASK

Analyze the open issues and build a dependency graph. For each issue, determine whether it **blocks** or **is blocked by** any other open issue.

An issue B is **blocked by** issue A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
- B's requirements depend on a decision or API shape that A will establish

An issue is **unblocked** if it has zero blocking dependencies on other open issues.

For each unblocked issue, assign a branch name using the exact format `sandcastle/issue-{id}` (no slug or other suffix). This must be deterministic so that re-planning the same issue always produces the same branch name and accumulated progress is preserved.

# OUTPUT

Output your plan as a JSON object wrapped in `<plan>` tags:

<plan>
{"issues": [{"id": "42", "title": "Fix auth bug", "branch": "sandcastle/issue-42"}]}
</plan>

Include only the issues from `<issues-json>`. Do not invent fallback work. If
the list is empty, output `<plan>{"issues": []}</plan>`.

Always emit the `<plan>` tags, even when there is nothing to do. If there are no issues to work on at all, output `<plan>{"issues": []}</plan>` so the run can exit cleanly.
