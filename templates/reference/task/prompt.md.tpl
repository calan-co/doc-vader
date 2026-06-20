Implement {{ task.id }}: {{ task.title }}

Use `dv task show {{ task.id }} --json` as the authoritative task model. Use this prompt only as a rendered view of that JSON.

Task file: {{ task.filePath }}
Status: {{ task.status }}
Lifecycle: {{ task.lifecycle }}

Acceptance criteria:
{% for criterion in task.acceptanceCriteria %}
- {{ criterion.text }}
{% endfor %}

Validation-relevant metadata:
- AFK: {{ task.validation.isAfk }}
- HITL: {{ task.validation.isHitl }}
- Dependencies satisfied: {{ task.validation.dependenciesSatisfied }}

Keep selection, claims, validation, and linking decisions in code. Templjs rendering is presentation only.

Temporary checklist and completion protocol:

Until Doc-Vader has runtime-backed claim completion, maintain checklist state explicitly.

1. Check `- [ ]` items only when concrete branch evidence satisfies the item.
2. Leave unsupported, partial, or blocked items unchecked.
3. Record evidence with `dv task record --claim` after validation passes.
4. Do not mark the Work Item complete or closed from an implementation prompt.
5. Output `<promise>COMPLETE</promise>` only when all required task, deliverable, and acceptance checkboxes for this slice are checked with evidence and validation has passed.
