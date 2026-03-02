---
id: templjs-consumer-migration
title: TemplJS Consumer Migration to Doc-Vader
type: document
subtype: how-to
lifecycle: active
status: proposed
---

<!-- markdownlint-disable MD013 -->

## Goal

Define a testable migration path for `templjs` to consume `doc-vader` validation contracts without legacy `../templjs/scripts/ci/*` coupling.

## Shared Contract Mapping

| Shared Engine Contract (`doc-vader`) | TemplJS Consumer Hook | Command Example |
| --- | --- | --- |
| Error-only backlog gate | PR blocking validation | `node ./node_modules/.bin/doc-vader backlog validate --dir backlog --fail-on error` |
| CI strict profile gate with JSON artifact | CI job artifact + merge gate | `sh staging/scripts/backlog-hygiene-ci.sh` |
| Machine-readable audit output | CI reporting and historical evidence | `node dist/cli/doc-vader.js backlog validate --dir backlog --profile profiles/backlog-ci.json --format json > backlog/audit/auditing-backlog-report.json` |
| Profile-driven governance | Repo policy selection by profile file | `node ./node_modules/.bin/doc-vader backlog validate --dir backlog --profile profiles/backlog-ci.json` |
| Optional schema routing | Consumer-specific schema map compatibility | `node ./node_modules/.bin/doc-vader backlog validate --dir backlog --schema-map schemas/schema-map.json` |

## Migration Sequence

### Pilot

1. Pin `doc-vader` CLI version in `templjs` dev dependencies.
2. Run `doc-vader backlog validate --dir backlog --fail-on error` in parallel with existing jobs.
3. Publish JSON artifact for every pilot run.

Rollback criteria:

- Revert to existing `templjs` validation command set if CLI parity is not reached within two consecutive CI runs.
- Re-enable legacy gate only for the failing branch while parity fixes are applied.

### Parity

1. Compare pilot output with existing `templjs` CI checks for three consecutive PRs.
2. Replace external script references with direct `doc-vader` command invocations in `templjs` CI config.
3. Enforce `--profile profiles/backlog-ci.json` in branch protection checks.

Rollback criteria:

- Restore previous CI command block if severity mismatches or schema-map regressions are found.
- Freeze further migration until mismatch root cause is documented and validated.

### Cutover

1. Remove legacy `../templjs/scripts/ci/*` references from `templjs` validation jobs.
2. Keep only `doc-vader` command contracts (`--fail-on`, `--profile`, `--format json`, `--schema-map`).
3. Require artifact retention for audit traceability.

Rollback criteria:

- Revert to the last parity-verified commit if cutover introduces blocking false positives.
- Open follow-up regression work item before retrying cutover.

## Testable Consumer Command Set (No Legacy Coupling)

1. `node ./node_modules/.bin/doc-vader backlog validate --dir backlog --fail-on error`
2. `node ./node_modules/.bin/doc-vader backlog validate --dir backlog --profile profiles/backlog-ci.json`
3. `node ./node_modules/.bin/doc-vader backlog validate --dir backlog --profile profiles/backlog-ci.json --format json > backlog/audit/auditing-backlog-report.json`
4. `node ./node_modules/.bin/doc-vader backlog validate --dir backlog --schema-map schemas/schema-map.json`

## Dependency and Risk Log

| Dependency | Current Status | Risk | Unblock Condition |
| --- | --- | --- | --- |
| `170.remark-lint-unified-adoption-epic` | proposed | Contract drift across lint rules | Mark core remark-lint adoption criteria complete |
| `171.2.4.task-update-docs-lint-sh-to-use-remark-lint-pipeline` | proposed | CI behavior mismatch with old shell pipeline | Confirm docs-lint pipeline parity in shared engine runs |
| `172.frontmatter-schema-integration-feature` | accepted | Schema mismatch between producer and consumer | Finalize schema-map compatibility checks |
| `support-multi-frameworks` | proposed | Profile interpretation inconsistency | Confirm profile selection and deterministic policy mapping |
| `framework-reconciliation` | proposed | Multi-framework conflict handling differences | Confirm deterministic reconciliation behavior in CI |

## Notes

- 2026-03-02: Validated strict backlog hygiene gate in `doc-vader` (`pnpm run backlog:validate:ci`, `exit_code=0`) before defining consumer migration steps.
- 2026-03-02: Command mapping intentionally uses direct `doc-vader` invocations to remove dependency on `../templjs/scripts/ci/*`.
