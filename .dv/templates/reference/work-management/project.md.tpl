---
type: project
"$schema": schemas/work-management/frontmatter/project.json
"$content_schema": schemas/work-management/content/project.json
---

## Summary

{# Summarize the project boundary, the operating context, and the outcome this
initiative exists to create. #}

{{ narrative }}

## Objectives

{% for objective in objectives %}

- {{ objective }}

{% endfor %}

## Scope

### In Scope

{% for item in scope.included %}

- {{ item }}

{% endfor %}

### Out Of Scope

{% for item in scope.excluded %}

- {{ item }}

{% endfor %}

{% if operatingConstraints %}

## Operating Constraints

{% for constraint in operatingConstraints %}

- {{ constraint }}

{% endfor %}
{% endif %}

## Success Criteria

{% for criterion in successCriteria %}

- {{ criterion }}

{% endfor %}

{% if relationships %}

## Relationships

{% for relationship in relationships %}

- {{ relationship.type }}: `{{ relationship.target }}`
  {% if relationship.note %}note: {{ relationship.note }} {# Add a note only when it materially explains the edge. #}{% endif %}

{% endfor %}
{% endif %}

## Notes

{# Add narrative context, sequencing notes, or rationale that helps a reader
interpret the project without affecting extracted structure. #}

{% if notes | type == "array" %}
{% for note in notes %}

- {{ note }}

{% endfor %}
{% else %}
{{ notes }}
{% endif %}
