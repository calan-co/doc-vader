---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60498
title: Staging-Native Resource-First Delivery Integration
summary: Port the verified resource-first Work delivery to staging while retaining staging runtime authority and recovery semantics.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 8
tags:
  - work-management
  - cli
  - runtime
  - recovery
  - escalation
  - afk
---

## Goal

Integrate the resource/id/subresource Work command and bounded escalation
behavior into staging without restoring retired `wi`, `task`, or verb-first
Work contracts.

## Tasks

- [ ] Port the staging-native Claim authority, recovery safety, and command-operation seams.
- [ ] Replace the public Work CLI with canonical resource/id/subresource routes and update Sandcastle transport.
- [ ] Add bounded, fail-closed escalation consumption with compensation and recovery coverage.
- [ ] Regenerate staging-native validation evidence; do not import source completion evidence.

## Acceptance Criteria

- [ ] Staging retains one repository Runtime Claim authority and fail-closed recovery safety behavior.
- [ ] Every Work-Item operation uses `dv work <work-item-id> ...`; `dv wi`, `dv task`, graph, and verb-first item routes are unavailable.
- [ ] Escalations are scope-bound, expiry/use bounded, audited, compensable, and recovered safely.
- [ ] Focused and full validation runs attest this staging port before any closure transition.

## Source Delivery Provenance

This work item tracks a staging port, not source delivery completion. Source
lineage `wi-60475` through `wi-60482` and [schema remediation
`wi-60442`](https://github.com/calan-co/doc-vader/blob/sandcastle-root/backlog/60442-schema-alias-policy-and-lifecycle-gate.md)
remain provenance only. The source implementation range is
[`ccf904f1..8c6bcc0f`](https://github.com/calan-co/doc-vader/compare/ccf904f1...8c6bcc0f),
including the resource-first cutover, bounded escalation hardening, and
versioned schema-reference remediation. Its completed statuses, records, and
audit artifacts are not staging evidence and are not imported here.
