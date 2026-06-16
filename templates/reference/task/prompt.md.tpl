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
