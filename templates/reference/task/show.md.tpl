# {{ title }}

- ID: `{{ id }}`
- File: `{{ filePath }}`
- Status: `{{ status }}`
- Lifecycle: `{{ lifecycle }}`

{% if tags %}
## Tags

{% for tag in tags %}
- `{{ tag }}`
{% endfor %}
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

## Sections

{% for section in body.sections %}
### {{ section.title }}

{{ section.content }}
{% endfor %}
