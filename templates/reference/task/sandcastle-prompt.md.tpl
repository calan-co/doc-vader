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
