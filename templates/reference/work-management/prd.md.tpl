---
# yaml-language-server: $schema=https://raw.githubusercontent.com/calan-co/doc-vader/main/schemas/work-management/frontmatter/prd.json
"$schema": https://raw.githubusercontent.com/calan-co/doc-vader/main/schemas/work-management/frontmatter/prd
"$content_schema": schemas/work-management/content/prd.json
"$template": templates/reference/work-management/prd.md.tpl
"type": plan
"subtype": x-prd
"id": "{{metadata.id}}"
"title": "{{metadata.title}}"
"lifecycle": active
"status": ready
"summary": "{{metadata.summary}}"
---

## Artifact Strategy

{# The JSON payload is the source of truth. Rendered Markdown is a human-facing view. -#}

- Source of truth: `{{ artifactStrategy.sourceOfTruth }}`
- Rendered views:{% for view in artifactStrategy.renderedViews %} `{{ view }}`{% endfor %}
- Preservation: {{ artifactStrategy.preservation }}

## Context Grounding

{# Capture the repo/context scan that the original to-prd skill performs implicitly.
Use domain vocabulary from the codebase and note ADR alignment explicitly, even when
the result is "No relevant ADRs found." -#}

{{ contextGrounding.codebaseContext }}

### Domain Vocabulary

{% for term in contextGrounding.domainVocabulary -%}
- {{ term }}
{% endfor %}
### ADR Alignment

{{ contextGrounding.adrAlignment }}

{% if contextGrounding.sourceContext -%}
### Source Context

{% for item in contextGrounding.sourceContext -%}
- {{ item }}
{% endfor -%}
{% endif %}
## Problem Statement

{# State the user's problem from the user's perspective. Include the current pain,
the consequence of leaving it unresolved, and the job the user is trying to do. -#}

{{ problemStatement }}

## Solution

{# State the solution from the user's perspective. Describe the resulting
experience and the decision boundary without drifting into implementation trivia. -#}

{{ solution }}

## Coverage Model

{# Completeness is measured against this model, not by meeting a story count. -#}

### Actors

{% for actor in coverageModel.actors -%}
- {{ actor }}
{% endfor %}
### Journey Stages

{% for stage in coverageModel.journeyStages -%}
- {{ stage }}
{% endfor %}
### Concerns

{% for concern in coverageModel.concerns -%}
- {{ concern }}
{% endfor -%}

{% if coverageModel.notes %}
### Coverage Notes

{% if coverageModel.notes | type == "array" -%}
{% for note in coverageModel.notes -%}
- {{ note }}
{% endfor -%}
{% else -%}
{{ coverageModel.notes }}
{% endif %}
{% endif -%}

## User Stories

{# Keep each story in the form "As an <actor>, I want <feature>, so that <benefit>."
Generate stories from the coverage model, then audit gaps explicitly. -#}

{% for story in userStories -%}
{{ loop.index }}. {{ story.story }}
   Covers: {{ story.covers.actor }} / {{ story.covers.journeyStage }} / {{ story.covers.concern }}{% if story.notes %}
   Note: {{ story.notes }}{% endif %}
{% endfor %}
## Coverage Review

Status: `{{ coverageReview.status }}`

{{ coverageReview.notes }}

{% if coverageReview.gaps -%}
### Coverage Gaps

{% for gap in coverageReview.gaps -%}
- {{ gap.gap }}
  Reason: {{ gap.reason }}
{% endfor %}
{% endif -%}

## Quality Review

{# Use this rubric to expose weak reasoning before handoff. Scores are 1-5. -#}

{% for dimension in qualityReview.dimensions -%}
- {{ dimension.name }}: {{ dimension.score }}/5
  Rationale: {{ dimension.rationale }}
{% endfor %}
{{ qualityReview.notes }}

## Implementation Decisions

{# Include durable decisions only: modules or boundaries to change, interfaces,
technical clarifications, architecture, schema changes, API contracts, and specific
interactions. Avoid file paths and code snippets unless the snippet came from a
prototype and captures the decision more precisely than prose. -#}

{% for decision in implementationDecisions -%}
- {{ decision.statement }}
  Rationale: {{ decision.rationale }}
{% if decision.category -%}
  Category: `{{ decision.category }}`
{% endif -%}
{% if decision.prototypeSnippet -%}

  Prototype-derived snippet:

  ```{{ decision.prototypeSnippet.language }}
{{ decision.prototypeSnippet.body }}
  ```

  {{ decision.prototypeSnippet.note }}
{% endif -%}
{% endfor %}
## Testing Decisions

{# Test external behavior at the highest practical seam. Prefer existing seams.
If new seams are needed, state why they are the highest useful seam. -#}

{{ testingDecisions.behaviorContract }}

### Modules Under Test

{% for module in testingDecisions.modulesUnderTest -%}
- {{ module }}
{% endfor %}
### Test Seams

{% for seam in testingDecisions.seams -%}
- {{ seam.name }} (`{{ seam.level }}`): {{ seam.rationale }}
{% if seam.existingPriorArt -%}
  Prior art:
{% for item in seam.existingPriorArt -%}
  - {{ item }}
{% endfor -%}
{% endif -%}
{% endfor %}
### Prior Art

{% for item in testingDecisions.priorArt -%}
- {{ item }}
{% endfor %}
{% if testingDecisions.validationGates -%}
### Validation Gates

{% for gate in testingDecisions.validationGates -%}
- {{ gate }}
{% endfor %}
{% endif -%}

### Seam Review

Status: `{{ testingDecisions.seamReview.status }}`

{{ testingDecisions.seamReview.notes }}

{% if successCriteria -%}
## Success Criteria

{% for criterion in successCriteria -%}
- {{ criterion }}
{% endfor %}
{% endif -%}

## Out of Scope

{# Preserve scope boundaries as explicit non-goals, not implied omissions. -#}

{% for item in outOfScope -%}
- {{ item }}
{% endfor %}
{% if agentHandoff -%}
## Agent Handoff

Ready label: `{{ agentHandoff.readyLabel }}`

{% for note in agentHandoff.handoffNotes -%}
- {{ note }}
{% endfor %}
{% endif -%}

{% if relationships -%}
## Relationships

{% for relationship in relationships -%}
- {{ relationship.type }}: `{{ relationship.target }}`{% if relationship.note %} Note: {{ relationship.note }}{% endif %}
{% endfor %}
{% endif -%}

## Further Notes

{# Include clarifications, tradeoffs, and unresolved-but-non-blocking context that
would help an implementation agent preserve intent. -#}

{% if furtherNotes | type == "array" -%}
{% for note in furtherNotes -%}
- {{ note }}
{% endfor -%}
{% else -%}
{{ furtherNotes }}
{% endif %}