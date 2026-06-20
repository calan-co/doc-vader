# Sandcastle Task: {{ id }}

Implement `{{ title }}` from `{{ filePath }}`.

## Current State

- Status: `{{ status }}`
- Lifecycle: `{{ lifecycle }}`
{% if tags %}
- Tags: `{{ tags }}`
{% endif %}

{% if dependencies %}
## Dependencies

{% for dependency in dependencies %}
- `{{ dependency.type }}`: {{ dependency.target }}
{% endfor %}
{% endif %}

## Acceptance Criteria

{% for criterion in acceptanceCriteria %}
- {{ criterion.text }}
{% endfor %}

## Source Context

{% for section in body.sections %}
### {{ section.title }}

{{ section.content }}
{% endfor %}

## Execution Boundary

Use the canonical task JSON as the source of truth. Do not implement claims, ready selection, task records, scope graphs, artifact reservations, hosted authority, revocation, or automatic close/finalize in this slice.

## Temporary Checklist and Completion Protocol

Until Doc-Vader has runtime-backed claim completion, maintain checklist state explicitly:

1. Check `- [ ]` items only when concrete branch evidence satisfies the item.
2. Leave unsupported, partial, or blocked items unchecked.
3. Record evidence with `dv task record --claim` after validation passes.
4. Do not mark the Work Item complete or closed from an implementation prompt.
5. Output `<promise>COMPLETE</promise>` only when all required task, deliverable, and acceptance checkboxes for this slice are checked with evidence and validation has passed.
