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

Use this local MVP flow when Sandcastle dogfoods Doc-Vader work items.

## Flow

1. Select work:

   ```bash
   dv task ready --json
   ```

2. Claim before implementation:

   ```bash
   dv task claim <task-id> --holder <agent-id> --branch <branch> --sandbox <path> --json
   ```

3. Inspect the authoritative model:

   ```bash
   dv task show <task-id> --json
   ```

4. Render the implementation prompt from the same model:

   ```bash
   dv task prompt <task-id>
   ```

5. Implement and validate with repository-native commands.

6. Record evidence through the active claim:

   ```bash
   dv task record --claim <claim-id> --payload payload.json --json
   ```

7. Release the local claim on success, stop, or failure:

   ```bash
   dv task release --claim <claim-id> --json
   ```

## Safety Boundary

The dogfood MVP stops before automatic close or finalize. A human or follow-on agent must review validation output, linked evidence, and existing closure gates before any work item close/finalize action.

This milestone intentionally defers scope graphs, artifact reservations, hosted authority, revocation, and automatic close/finalize.
