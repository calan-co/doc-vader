# Sandcastle Issue-Tracker Wiring

This repository treats the custom Sandcastle issue tracker as generated local
artifacts instead of hand-edited prompt text.

## Source Of Truth

- Template args: `scripts/sandcastle/init-artifacts.ts`
- Source templates: `scripts/sandcastle/templates/`
- Regeneration command: `node --import tsx scripts/sandcastle/init-artifacts.ts`

## Greenfield Init Contract

- Run `sandcastle init` in the consumer workspace to create `.sandcastle/`.
- A temporary validation fixture should start without a `.sandcastle/` directory before init runs.
- This repository may still commit `.sandcastle/` files for maintainer convenience.
- Treat checked-in `.sandcastle/` files as convenience copies of the generated contract, not as proof that init can be skipped in a fresh workspace.
- Prewarm the validation environment once per checkout with `scripts/sandcastle/prewarm-validation-env.sh` before the first baseline gate.
- Use `node --import tsx scripts/sandcastle/cold-start-validation-harness.ts` to capture a cold-start proof with fresh cache roots and JSON evidence artifacts.
- Use `node --import tsx scripts/sandcastle/greenfield-readiness-harness.ts` for an opt-in greenfield readiness proof that starts from `sandcastle init`.
- The readiness proof records whether committed `.sandcastle/` files are in sync with the generated scaffold manifest.

## Generated Adapter Commands

- List planning candidates: `{{LIST_TASKS_COMMAND}}`
- View canonical work item state: `{{VIEW_TASK_COMMAND}} <task-id>`
- Render implementation context: `{{PROMPT_TASK_COMMAND}} <task-id>`
- Claim work: `{{CLAIM_TASK_COMMAND}} <task-id> --holder <holder> --branch <branch> --json`
- Inspect pack-discovered checklists: `dv work <task-id> checklist [<checklist-id>] --json`
- Complete one check with evidence: `dv work <task-id> checklist <checklist-id> check <check-id> complete --claim <claim-id> --evidence <reference|json|-> --json`
- Clear one check: `dv work <task-id> checklist <checklist-id> check <check-id> clear --claim <claim-id> --json`
- Inspect lock ownership: `{{LOCK_STATUS_COMMAND}} --claim <claim-id> --json`
- Record evidence: `{{RECORD_TASK_COMMAND}} --claim <claim-id> --type <record-type> --payload <json-file|-> --json`
- Recover halted work: `{{RECOVER_TASK_COMMAND}} <task-id> --branch <branch> --json`
- Close through repository transition behavior: `{{CLOSE_TASK_COMMAND}} <task-id> --claim <claim-id> [--payload <json-file>] [--record-type <type>]`

Inspect pack-discovered checklists after claiming and before every targeted mutation. Check IDs
are revision-scoped: re-inspect after an address-drift error before retrying. Do not edit
Markdown checkboxes directly; use only the targeted complete/clear commands. Record evidence
before close; close evaluates the terminal Gate and releases the claim only when checks,
evidence, lifecycle, and claim authority permit completion.

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
