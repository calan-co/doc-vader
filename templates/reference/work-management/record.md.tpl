---
type: record
"$schema": schemas/work-management/frontmatter/record.json
"$content_schema": schemas/work-management/content/record.json
---

## Recorded At

{# Record the observation timestamp as an ISO 8601 datetime. #}

{{ recordedAt }}

{% if outcome %}

## Outcome

{{ outcome }}
{% endif %}

## Observation

{# Describe the observed event, evidence, approval, or comment captured by this
record. #}

{{ observation }}

{% if findings %}

## Findings

{% for finding in findings %}

- {{ finding }}

{% endfor %}
{% endif %}

## Subject References

{% for subjectRef in subjectRefs %}

- `{{ subjectRef }}`

{% endfor %}

{% if artifactRefs %}

## Artifact References

{% for artifactRef in artifactRefs %}

- {{ artifactRef }}

{% endfor %}
{% endif %}

## Notes

{# Add context that helps future readers interpret the record without changing
its extracted subject references or core observation. #}

{% if notes | type == "array" %}
{% for note in notes %}

- {{ note }}

{% endfor %}
{% else %}
{{ notes }}
{% endif %}
