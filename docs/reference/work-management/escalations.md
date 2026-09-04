---
$schema: /frontmatter/document
id: ref-60479
title: Bounded DV-Native Escalations
type: document
subtype: reference
status: ready
lifecycle: active
tags: [work, escalation, policy]
---

# Bounded DV-Native Escalations

An escalation is a DV-policy override, not a Runtime Claim and not authority to
bypass GitHub, credentials, OS controls, hooks, rulesets, or branch/protection
controls.

## Running Checklist Composition

The initial registry contains only `work.running-checklist-composition.v1`.
Create it with:

```sh
dv escalation create --policy work.running-checklist-composition.v1 --payload '<json>'
```

The payload is policy-owned and must contain exactly one canonical Work Item ID
in `scope`, `operation: "running-checklist-composition"`, an existing Work
check mutation shape in `composition`, and `expiresAt` or positive `maxUses`:

```json
{
  "scope": ["wi-123"],
  "operation": "running-checklist-composition",
  "composition": {
    "checklistId": "tasks",
    "checkId": "1-update-the-check",
    "action": "complete"
  },
  "maxUses": 1
}
```

Consume it only through a claimed running Work Item:

```sh
dv work wi-123 update --escalation esc-... --claim <claim-token>
```

The Work policy rejects policy, scope, expiry, use-bound, claim, checklist, and
running-category mismatches before applying the native Work check mutation. Each
successful consumption is retained as an audit event and is available through:

```sh
dv escalation esc-... show --json
```
