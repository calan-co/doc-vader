---
type: milestone
"$schema": schemas/work-management/frontmatter/milestone.json
"$content_schema": schemas/work-management/content/milestone.json
---

## Milestone Objective
{# Describe the capability, date, or decision boundary this milestone is meant to
make visible. #}

{{ milestoneObjective }}

## Success Signals

{% for signal in successSignals %}

- {{ signal }}

{% endfor %}

## Completion Definition

{% for condition in completionDefinition %}

- {{ condition }}

{% endfor %}

## Relationships

{% for relationship in relationships %}

- {{ relationship.type }}: `{{ relationship.target }}`
  {% if relationship.note %}note: {{ relationship.note }} {# Add a note only when it materially explains the edge. #}{% endif %}

{% endfor %}

## Notes

{# Add scheduling context, dependencies, or rationale that helps explain why the
milestone matters. #}

{% if notes | type == "array" %}
{% for note in notes %}

- {{ note }}

{% endfor %}
{% else %}
{{ notes }}
{% endif %}
