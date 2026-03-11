---
"$schema": schemas/work-management/frontmatter/plan.json
"$content_schema": schemas/work-management/content/plan.json
type: plan
---

## Intent

{# Explain the planning lens this plan provides and the decisions it is meant to support. #}
{{ intent }}

## Methodology

{# State the methodology token used by this plan, such as `agile`, `waterfall`,
`hybrid`, `remedial`, or `ad-hoc`. #}

{{ methodology }}

## Assumptions

{# List a planning assumption. #}
{% for assumption in assumptions %}

- {{ assumption }}

{% endfor %}

## Constraints

{# List a sequencing, staffing, timing, or scope constraint. #}
{% for constraint in constraints %}

- {{ constraint }}

{% endfor %}

## Entries

{# List the plan entries, which may include milestones, work-items, or other plans. #}
{% for entry in entries %}

{{ entry.position}}. Target: {{ entry.target }}
Status: {{ entry.status }}
Rationale: {{ entry.rationale }} {# Explain why this target appears in the plan. #}

{% endfor %}

## Relationships

{% for relationship in relationships %}

- {{ relationship.type }}: `{{ relationship.target }}`
  {% if relationship.note %}note: {{ relationship.note }} {# If not self-evident, explain why this relationship exists. #}{% endif %}

{% endfor %}

## Notes

{# Add narrative context, tradeoffs, and scenario framing that help readers use the plan. #}

{% if notes | type == "array" %}
{% for note in notes %}

- {{ note }}

{% endfor %}
{% else %}
{{ notes }}
{% endif %}
