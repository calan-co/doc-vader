---
id: workmanagement-3
title: Work-Item Lifecycle Command Reference
type: document
subtype: reference
lifecycle: active
status: ready
tags:
  - work-management
  - cli
  - commands
links:
  parent:
    - '[[overview.md]]'
---

# Work-Item Lifecycle Command Reference

`dv work` is the canonical Work Item CLI. `dv wi`, `dv task`, verb-first Work
routes, and qualifier/attest routes are unavailable.

## Commands

Only collection queries omit a Work Item ID:

```text
dv work list [--json | --porcelain]
dv work ready [--json [--candidates-only] | --porcelain]
```

Every Work Item operation is resource-first:

```text
dv work <work-item-id> show [--json]
dv work <work-item-id> status [--json]
dv work <work-item-id> update --input <json|file>
dv work <work-item-id> prompt
dv work <work-item-id> claim
dv work <work-item-id> claim <claim-token> release --outcome <outcome>
dv work <work-item-id> recover
dv work <work-item-id> record --claim <claim-token> --type <record-type> --payload <json-file|->
dv work <work-item-id> repair-generated-evidence --claim <claim-token> --record <path>
dv work <work-item-id> checklist [<checklist-id>]
dv work <work-item-id> checklist <checklist-id> check <check-id> complete --claim <claim-token> --evidence <reference|json|->
dv work <work-item-id> checklist <checklist-id> check <check-id> clear --claim <claim-token>
```

Checklist and check IDs are discovered from the selected document-type pack;
their format is not a CLI contract.

## Structured Updates

`update --input` accepts inline JSON, a JSON file, or `-` for standard input.
Its supported versioned transition payload fields are `fromStatus` or
`from_status`, `toStatus`, `to_status`, or `status`, optional `statusReason`,
`to_status_reason`, or `reason`, optional numeric `actual`, boolean
`clearEstimated`, and `assignee`. `clearEstimated: true` atomically removes an
estimate; it cannot be combined with `estimated`. The command validates the
payload and applies the resulting Work Item transition through the package
transaction; it does not accept verb-first update options.

## Related References

- [Canonical Work-Management Foundation](./overview.md)
- [Work-Management Foundation Package](./foundation.md)
