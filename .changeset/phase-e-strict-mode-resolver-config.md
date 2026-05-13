---
"@calan-co/doc-vader": minor
---

feat(210-phase-e): add strict mode and consumer config resolver order

Phase E adds:
- `automation.subjectResolutionOrder` support in consumer config (`backlog-consumer.json`)
- Resolver order precedence: CLI flag > consumer config > built-in default
- `ConsumerAutomation.subjectResolutionOrder` field in work-management types
- Configuration tests covering all precedence paths and strict mode behavior
- `docs/reference/work-management/backlog-scan-configuration.md` reference guide

`--strict` and `--resolver-order` CLI flags were already wired in Phase A; this phase connects consumer config fallback to complete the configuration system.
