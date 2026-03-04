---
id: closure-reason-policy
title: Closure Reason Policy
type: document
subtype: policy
lifecycle: active
status: proposed
---

## Required Closure Fields

When closing a work item:

- `status` must be `closed`
- `status_reason` must be one of:
  - `success`
  - `obsolete`
  - `redundant`
  - `superseded`
  - `cancelled`

## Reason Definitions

- `success`: Work completed as intended.
- `obsolete`: Work no longer relevant due to context change.
- `redundant`: Duplicate of another tracked item.
- `superseded`: Replaced by a better or newer item.
- `cancelled`: Explicitly stopped without replacement.

## Evidence Requirements

Each closure must include a timestamped note with:

- Why closure is valid.
- Replacement/superseding link if applicable.
- Any audit report reference used for decision making.
