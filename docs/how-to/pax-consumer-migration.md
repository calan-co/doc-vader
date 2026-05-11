---
id: paxconsu-6092
title: PAX Consumer Migration to Doc-Vader
type: document
subtype: generic
lifecycle: active
status: ready
---

## Goal

Define a testable migration path for `pax` to consume `doc-vader` validation contracts without any dependency on `templjs` repository scripts.

## Shared Contract Mapping

| Shared Engine Contract (`doc-vader`)      | PAX Consumer Hook                          | Command Example                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Error-only backlog gate                   | PR blocking validation                     | `node ./node_modules/.bin/doc-vader backlog validate --dir backlog --fail-on error`                                                                       |
| CI strict profile gate with JSON artifact | CI job artifact + merge gate               | `sh staging/scripts/backlog-hygiene-ci.sh`                                                                                                                |
| Machine-readable audit output             | CI reporting and historical evidence       | `node dist/cli/doc-vader.js backlog validate --dir backlog --profile profiles/backlog-ci.json --format json > backlog/audit/auditing-backlog-report.json` |
| Profile-driven governance                 | Repo policy selection by profile file      | `node ./node_modules/.bin/doc-vader backlog validate --dir backlog --profile profiles/backlog-ci.json`                                                    |
| Optional schema routing                   | Consumer-specific schema map compatibility | `node ./node_modules/.bin/doc-vader backlog validate --dir backlog --schema-map schemas/schema-map.json`                                                  |

## Migration Sequence

### Pilot

1. Pin `doc-vader` CLI version in `pax` dev dependencies.
2. Run `doc-vader backlog validate --dir backlog --fail-on error` alongside current `pax` checks.
3. Publish JSON audit artifact for each pilot run.

Rollback criteria:

- Revert to current `pax` validation commands if output parity is not achieved in two consecutive CI runs.
- Keep pilot-only execution while contract mismatches are investigated.

### Parity

1. Compare `doc-vader` output with existing `pax` checks for three consecutive PRs.
2. Replace any `templjs`-repo script references with direct `doc-vader` invocations.
3. Enforce `--profile profiles/backlog-ci.json` in required branch checks.

Rollback criteria:

- Restore previous CI command block if severity mapping or schema routing results diverge.
- Stop cutover promotion until parity diff root cause is documented.

### Cutover

1. Remove all `templjs` script coupling from `pax` validation jobs.
2. Keep only direct `doc-vader` contract commands (`--fail-on`, `--profile`, `--format json`, `--schema-map`).
3. Require retention of the generated JSON artifact for audit traceability.

Rollback criteria:

- Revert to the last parity-validated commit if cutover introduces blocking false positives.
- Open a regression follow-up work item before reattempting cutover.

## Testable Consumer Command Set (No TemplJS Coupling)

1. `node ./node_modules/.bin/doc-vader backlog validate --dir backlog --fail-on error`
2. `node ./node_modules/.bin/doc-vader backlog validate --dir backlog --profile profiles/backlog-ci.json`
3. `node ./node_modules/.bin/doc-vader backlog validate --dir backlog --profile profiles/backlog-ci.json --format json > backlog/audit/auditing-backlog-report.json`
4. `node ./node_modules/.bin/doc-vader backlog validate --dir backlog --schema-map schemas/schema-map.json`

## Dependency and Risk Log

| Dependency                                                     | Current Status | Risk                                                | Unblock Condition                                         |
| -------------------------------------------------------------- | -------------- | --------------------------------------------------- | --------------------------------------------------------- |
| `207.1.templjs-consumer-migration-story`                       | proposed       | Sequence dependency may hide shared contract gaps   | Validate `templjs` and `pax` command parity in one matrix |
| `170.remark-lint-unified-adoption-epic`                        | proposed       | Rule output drift across consumers                  | Mark core remark-lint adoption criteria complete          |
| `171.2.4.task-update-docs-lint-sh-to-use-remark-lint-pipeline` | proposed       | CI behavior mismatch with shared pipeline           | Confirm docs-lint pipeline parity in shared engine runs   |
| `172.frontmatter-schema-integration-feature`                   | accepted       | Schema interpretation differences between consumers | Finalize schema-map compatibility checks                  |
| `support-multi-frameworks`                                     | proposed       | Profile selection divergence between repos          | Confirm deterministic profile mapping across consumers    |
| `framework-reconciliation`                                     | proposed       | Different framework conflict resolutions in CI      | Confirm deterministic reconciliation behavior in CI       |

## Notes

- 2026-03-02: Validated strict backlog hygiene gate in `doc-vader` (`pnpm run backlog:validate:ci`, `exit_code=0`) before defining `pax` migration steps.
- 2026-03-02: Command mapping explicitly removes `templjs` script coupling by using direct `doc-vader` invocations.
