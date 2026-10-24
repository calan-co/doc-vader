---
type: work-item
"$schema": schemas/work-management/frontmatter/work-item.json
"$content_schema": schemas/work-management/content/work-item.json
---

## Goal

{# Describe the high-level objective this work item is meant to achieve. #}
{{ goal }}

{% if background %}
## Background

{% for item in background %}
- {{ item }}
{% endfor %}
{% endif %}

## Tasks

{% for task in tasks %}
- [{{ task.done ? "x" : " " }}] {{ task.text }}
{% if task.subtasks %}
{% for subtask in task.subtasks %}
  - [{{ subtask.done ? "x" : " " }}] {{ subtask.text }}
{% endfor %}
{% endif %}
{% endfor %}

{% if deliverables %}
## Deliverables

{% for deliverable in deliverables %}
- {{ deliverable }}
{% endfor %}
{% endif %}

## Acceptance Criteria

{% for criterion in acceptanceCriteria %}
- [{{ criterion.done ? "x" : " " }}] {{ criterion.text }}{% if criterion.verification %} Verification: {{ criterion.verification }}{% endif %}
{% endfor %}

## Relationships

{% for relationship in relationships %}
- `{{ relationship.type }}`: `{{ relationship.target }}`{% if relationship.note %} Note: {{ relationship.note }}{% endif %}
{% endfor %}

{% if links && links.reference %}
## References

{% for reference in links.reference %}
- {{ reference }}
{% endfor %}
{% endif %}

{% if scope %}
## Scope

{% if scope.successCriteria %}
### Success Criteria

{% for item in scope.successCriteria %}
- {{ item }}
{% endfor %}
{% endif %}

{% if scope.nonGoals %}
### Non-Goals

{% for item in scope.nonGoals %}
- {{ item }}
{% endfor %}
{% endif %}

{% if scope.futureEnhancements %}
### Future Enhancements

{% for item in scope.futureEnhancements %}
- {{ item }}
{% endfor %}
{% endif %}

{% if scope.timeline %}
### Timeline

{% for item in scope.timeline %}
- {{ item }}
{% endfor %}
{% endif %}

{% if scope.risksAndMitigations %}
### Risks And Mitigations

{% for item in scope.risksAndMitigations %}
- {{ item }}
{% endfor %}
{% endif %}

{% if scope.refs %}
### References

{% for reference in scope.refs %}
- {{ reference }}
{% endfor %}
{% endif %}
{% endif %}

{% if design %}
## Design

{% if design.architecture %}
### Architecture

{{ design.architecture }}
{% endif %}

{% if design.technicalChallenges %}
### Technical Challenges

{% for item in design.technicalChallenges %}
- {{ item }}
{% endfor %}
{% endif %}

{% if design.keyQuestions %}
### Key Questions

{% for item in design.keyQuestions %}
- {{ item }}
{% endfor %}
{% endif %}

{% if design.apiSketch %}
### API Sketch

{{ design.apiSketch }}
{% endif %}

{% if design.inputFormats %}
### Input Formats

{% for item in design.inputFormats %}
- {{ item }}
{% endfor %}
{% endif %}

{% if design.configurationPrecedence %}
### Configuration Precedence

{% for item in design.configurationPrecedence %}
{{ loop.index }}. {{ item }}
{% endfor %}
{% endif %}

{% if design.styleGuidelines %}
### Style Guidelines

{% for item in design.styleGuidelines %}
- {{ item }}
{% endfor %}
{% endif %}

{% if design.refs %}
### References

{% for reference in design.refs %}
- {{ reference }}
{% endfor %}
{% endif %}
{% endif %}

{% if examples %}
## Examples

{% if examples.usageExamples %}
### Usage Examples

{% for item in examples.usageExamples %}
- {{ item }}
{% endfor %}
{% endif %}

{% if examples.cliFlags %}
### CLI Flags

{% for item in examples.cliFlags %}
- {{ item }}
{% endfor %}
{% endif %}

{% if examples.templateExamples %}
### Template Examples

{{ examples.templateExamples }}
{% endif %}

{% if examples.demoOutline %}
### Demo Outline

{% for item in examples.demoOutline %}
- {{ item }}
{% endfor %}
{% endif %}

{% if examples.gettingStarted %}
### Getting Started

{% for item in examples.gettingStarted %}
- {{ item }}
{% endfor %}
{% endif %}

{% if examples.refs %}
### References

{% for reference in examples.refs %}
- {{ reference }}
{% endfor %}
{% endif %}
{% endif %}

{% if testing %}
## Testing

{% if testing.strategy %}
### Strategy

{{ testing.strategy }}
{% endif %}

{% if testing.categories %}
### Categories

{% for item in testing.categories %}
- {{ item }}
{% endfor %}
{% endif %}

{% if testing.exampleTests %}
### Example Tests

{% for item in testing.exampleTests %}
- {{ item }}
{% endfor %}
{% endif %}

{% if testing.runCommands %}
### Run Commands

{% for item in testing.runCommands %}
- {{ item }}
{% endfor %}
{% endif %}

{% if testing.scenarios %}
### Scenarios

{% for item in testing.scenarios %}
- {{ item }}
{% endfor %}
{% endif %}

{% if testing.roundTripExample %}
### Round-Trip Example

{{ testing.roundTripExample }}
{% endif %}

{% if testing.ambiguityResolution %}
### Ambiguity Resolution

{{ testing.ambiguityResolution }}
{% endif %}

{% if testing.validationExamples %}
### Validation Examples

{% for item in testing.validationExamples %}
- {{ item }}
{% endfor %}
{% endif %}

{% if testing.typeCoercionExamples %}
### Type Coercion Examples

{% for item in testing.typeCoercionExamples %}
- {{ item }}
{% endfor %}
{% endif %}

{% if testing.refs %}
### References

{% for reference in testing.refs %}
- {{ reference }}
{% endfor %}
{% endif %}
{% endif %}

{% if operations %}
## Operations

{% if operations.releaseChecklist %}
### Release Checklist

{% for item in operations.releaseChecklist %}
- {{ item }}
{% endfor %}
{% endif %}

{% if operations.postReleaseMonitoring %}
### Post-Release Monitoring

{% for item in operations.postReleaseMonitoring %}
- {{ item }}
{% endfor %}
{% endif %}

{% if operations.runbookOutline %}
### Runbook Outline

{% for item in operations.runbookOutline %}
- {{ item }}
{% endfor %}
{% endif %}

{% if operations.performanceTargets %}
### Performance Targets

{% for item in operations.performanceTargets %}
- {{ item }}
{% endfor %}
{% endif %}

{% if operations.skillsIntegration %}
### Skills Integration

{% for item in operations.skillsIntegration %}
- {{ item }}
{% endfor %}
{% endif %}

{% if operations.lintingTechnologies %}
### Linting Technologies

{% for item in operations.lintingTechnologies %}
- {{ item }}
{% endfor %}
{% endif %}

{% if operations.secretScanning %}
### Secret Scanning

{% for item in operations.secretScanning %}
- {{ item }}
{% endfor %}
{% endif %}

{% if operations.refs %}
### References

{% for reference in operations.refs %}
- {{ reference }}
{% endfor %}
{% endif %}
{% endif %}

{% if analysis %}
## Analysis

{% if analysis.summary %}
### Summary

{{ analysis.summary }}
{% endif %}

{% if analysis.topRegions %}
### Top Regions

{% for item in analysis.topRegions %}
- {{ item }}
{% endfor %}
{% endif %}

{% if analysis.comparisonTable %}
### Comparison Table

{{ analysis.comparisonTable }}
{% endif %}

{% if analysis.refs %}
### References

{% for reference in analysis.refs %}
- {{ reference }}
{% endfor %}
{% endif %}
{% endif %}

{% if notes %}
## Notes

{% for note in notes %}
- {{ note }}
{% endfor %}
{% endif %}
