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

{% if relationships %}
## Relationships

{% for relationship in relationships %}
- `{{ relationship.type }}`: {{ relationship.target }}
{% endfor %}
{% endif %}

{% if records %}
## Records

{% for record in records %}
- `{{ record.type }}`: {{ record.target }}
{% endfor %}
{% endif %}

{% if activeLocks %}
## Active Locks

{% for lock in activeLocks %}
- claim=`{{ lock.claimToken }}` scope=`{{ lock.scopeRef }}` mode=`{{ lock.lockMode }}`
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
