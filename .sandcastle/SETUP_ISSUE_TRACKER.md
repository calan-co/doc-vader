# Sandcastle Issue-Tracker Wiring

This repository treats the custom Sandcastle issue tracker as generated local
artifacts instead of hand-edited prompt text.

## Source Of Truth

- Template args: `scripts/sandcastle/init-artifacts.ts`
- Source templates: `scripts/sandcastle/templates/`
- Regeneration command: `node --import tsx scripts/sandcastle/init-artifacts.ts`

## Generated Adapter Commands

- List planning candidates: `node --import tsx scripts/sandcastle/dv4sandcastle.ts list`
- View canonical work item state: `node --import tsx scripts/sandcastle/dv4sandcastle.ts view <task-id>`
- Render implementation context: `node --import tsx scripts/sandcastle/dv4sandcastle.ts prompt <task-id>`
- Claim work: `node --import tsx scripts/sandcastle/dv4sandcastle.ts claim-task <task-id> --holder <holder> --branch <branch> --json`
- Inspect lock ownership: `node --import tsx scripts/sandcastle/dv4sandcastle.ts lock-status --claim <claim-id> --json`
- Recover halted work: `node --import tsx scripts/sandcastle/dv4sandcastle.ts recover-task <task-id> --branch <branch> --json`
- Close through repository transition behavior: `node --import tsx scripts/sandcastle/dv4sandcastle.ts close-task <task-id> --claim <claim-id> [--payload <json-file>] [--record-type <type>]`

## Durable Guidance

- Current operator guidance:
  [`docs/how-to/sandcastle-dogfood-task-flow.md`](../docs/how-to/sandcastle-dogfood-task-flow.md)
- Treat completed backlog items as history only; the guide above plus these
  generated artifacts are the current contract.

## Tracker Tools

# Doc-Vader custom issue tracker: uses the repository checkout, Node.js, and tsx.
# No external issue-tracker CLI install is required.

## Update Flow

1. Change the template args or source templates when the `dv4sandcastle`
   contract changes.
2. Regenerate the checked-in artifacts with
   `node --import tsx scripts/sandcastle/init-artifacts.ts`.
3. Commit the updated `.sandcastle` outputs together with any adapter changes.

Do not edit `.sandcastle/plan-prompt.md` or `.sandcastle/implement-prompt.md` directly. Regenerate them from the template args instead.
