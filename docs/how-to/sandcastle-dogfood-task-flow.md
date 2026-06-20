---
id: howto-60358
title: Sandcastle Dogfood Task Flow
type: document
subtype: how-to
lifecycle: active
status: ready
tags:
  - sandcastle
  - dogfood
  - task-cli
---

# Sandcastle Dogfood Task Flow

Use this local MVP flow when Sandcastle dogfoods Doc-Vader work items through the entity-governance runtime.

## Flow

1. Select work:

   ```bash
   dv task ready --json
   ```

2. Claim before implementation:

   ```bash
   dv task claim <task-id> --holder <agent-id> --branch <branch> --sandbox <path> --json
   ```

3. Lock files before editing:

   ```bash
   dv lock create --claim <claim-token> <path...> --json
   ```

4. Inspect the authoritative model:

   ```bash
   dv task show <task-id> --json
   ```

5. Render the implementation prompt from the same model:

   ```bash
   dv task prompt <task-id>
   ```

6. Implement and validate with repository-native commands.

7. Record evidence through the active claim:

   ```bash
   dv task record --claim <claim-id> --payload payload.json --json
   ```

8. Complete or halt the runtime claim:

   ```bash
   dv claim complete <claim-token> --json
   ```

   ```bash
   dv claim halt <claim-token> --reason blocked --json
   ```

## Safety Boundary

Runtime claim completion does not directly close or finalize the Work Item. A human or follow-on agent must review validation output, linked evidence, and existing closure gates before any Work Item lifecycle close/finalize action.

This milestone intentionally defers full Work Graph or Decision Graph engines, scope graphs, nested artifact reservations, hosted authority, and automatic Work Item close/finalize.
