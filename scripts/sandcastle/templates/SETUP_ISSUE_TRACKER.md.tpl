# Sandcastle Issue-Tracker Wiring

This repository treats the custom Sandcastle issue tracker as generated local
artifacts instead of hand-edited prompt text.

## Source Of Truth

- Template args: `scripts/sandcastle/init-artifacts.ts`
- Source templates: `scripts/sandcastle/templates/`
- Regeneration command: `node --import tsx scripts/sandcastle/init-artifacts.ts`

## Generated Adapter Commands

- List planning candidates: `{{LIST_TASKS_COMMAND}}`
- View canonical work item state: `{{VIEW_TASK_COMMAND}} <task-id>`
- Render implementation context: `{{PROMPT_TASK_COMMAND}} <task-id>`
- Claim work: `{{CLAIM_TASK_COMMAND}} <task-id> --holder <holder> --branch <branch> --json`
- Inspect lock ownership: `{{LOCK_STATUS_COMMAND}} --claim <claim-id> --json`
- Recover halted work: `{{RECOVER_TASK_COMMAND}} <task-id> --branch <branch> --json`
- Close through repository transition behavior: `{{CLOSE_TASK_COMMAND}} <task-id> --claim <claim-id> [--payload <json-file>] [--record-type <type>]`

## Durable Guidance

- Current operator guidance:
  [`docs/how-to/sandcastle-dogfood-task-flow.md`](../docs/how-to/sandcastle-dogfood-task-flow.md)
- Treat completed backlog items as history only; the guide above plus these
  generated artifacts are the current contract.

## Tracker Tools

{{ISSUE_TRACKER_TOOLS}}

## Update Flow

1. Change the template args or source templates when the `dv4sandcastle`
   contract changes.
2. Regenerate the checked-in artifacts with
   `node --import tsx scripts/sandcastle/init-artifacts.ts`.
3. Commit the updated `.sandcastle` outputs together with any adapter changes.

Do not edit `.sandcastle/plan-prompt.md` or `.sandcastle/implement-prompt.md` directly. Regenerate them from the template args instead.
