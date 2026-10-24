---
type: release
"$schema": schemas/work-management/frontmatter/release.json
"$content_schema": schemas/work-management/content/release.json
---

## Release Objective

{# Describe the release boundary, the ship-worthy outcome, and the reason this
release exists. #}

{{ releaseObjective }}

## Release Scope

{% for scopeItem in releaseScope %}

- {{ scopeItem }}

{% endfor %}

## Readiness Gates

{% for gate in readinessGates %}

- {{ gate }}

{% endfor %}

## Rollout Notes

{% for rolloutNote in rolloutNotes %}

- {{ rolloutNote }}

{% endfor %}

## Relationships

{% for relationship in relationships %}

- {{ relationship.type }}: `{{ relationship.target }}`
  {% if relationship.note %}note: {{ relationship.note }} {# Add a note only when it materially explains the edge. #}{% endif %}

{% endfor %}

## Notes

{# Add context that helps the release read as an authored artifact rather than a
purely machine-generated summary. #}

{% if notes | type == "array" %}
{% for note in notes %}

- {{ note }}

{% endfor %}
{% else %}
{{ notes }}
{% endif %}
