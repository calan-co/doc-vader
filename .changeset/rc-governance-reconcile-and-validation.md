---
"@calan-co/doc-vader": minor
---

Add deterministic governance reconciliation support for RC execution and improve backlog validation profile handling.

- Add multi-profile support to `backlog validate` with deterministic merge behavior and profile trace output in audit options.
- Replace placeholder governance reconciliation with a deterministic `priority-order` strategy and machine-readable conflict/decision trace.
- Use robust YAML frontmatter parsing for governance detection/reconciliation paths.
- Align frontmatter document schema variants to accept `status: ready` for active and evergreen lifecycle states used by backlog work items.
