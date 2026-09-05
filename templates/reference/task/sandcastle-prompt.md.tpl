# Sandcastle Work Item: {{ id }}

Implement `{{ title }}` from `{{ filePath }}`.

Initialization and registry mapping live in `docs/how-to/sandcastle-dogfood-task-flow.md`. Use that guide for environment setup, `dv work ready`, claims, locks, evidence, and terminal claim handling.

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

{% if relationships %}
## Relationships

{% for relationship in relationships %}
- `{{ relationship.type }}`: {{ relationship.target }}
{% endfor %}
{% endif %}

## Acceptance Criteria

{% for criterion in acceptanceCriteria %}
- {{ criterion.text }}
{% endfor %}

## Sandcastle Flow

1. Claim this work item before execution with `dv work <task-id> claim --holder <holder> --json`, then use the returned claim token for every subsequent runtime command.
2. Acquire file ownership lazily with `dv lock create --claim <claim-token> <path...>` before mutating any non-Doc-Vader file.
3. Clean up only unmodified resources with `dv lock rm --claim <claim-token> <path...>` after confirming the files were not changed by your branch.
4. Let lifecycle commands enforce changed-file lock audits before record or completion; do not treat Git hooks or prompt instructions as deterministic enforcement.
5. Route unrecoverable lock conflicts to `dv claim release <claim-token> --outcome conflict`.
6. If the work item is blocked after a non-success release, recover it with `dv work <task-id> recover`.
7. Keep successful claim release behind the existing validation and evidence gates.

## Source Context

{% for section in body.sections %}
### {{ section.title }}

{{ section.content }}
{% endfor %}

## Execution Boundary

Use the canonical work item JSON as the source of truth. Do not implement claims, ready selection, work records, scope graphs, artifact reservations, hosted authority, revocation, or automatic close/finalize in this slice.

## Checklist and Gate Protocol

1. Inspect current pack-discovered checklists with `dv work {{id}} checklist --json` before attempting a targeted mutation.
2. Complete or clear only the returned revision-scoped checks through `dv work {{id}} checklist <checklist-id> check <check-id> complete|clear --claim <claim-token>`; completion also requires `--evidence`.
3. Record evidence with `dv work {{id}} record --claim` after validation passes.
4. Do not mark the Work Item complete or closed from an implementation prompt. The terminal Gate decides completion from checklists, evidence, lifecycle, and Runtime Claim authority.
5. Output `<promise>COMPLETE</promise>` only after the terminal Gate permits completion and the public claim release command succeeds.
