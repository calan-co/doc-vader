# Changelog

## 0.1.0

### Minor Changes

- c9ad178: feat(210-phase-b): Implement vendor abstraction and PR-link resolver

  **Phase B: Vendor Adapter & PR-Link Resolver**

  Adds vendor-agnostic backlog automation infrastructure:

  - `BacklogAutomationProvider` interface for multi-forge support (GitHub, GitLab, Bitbucket)
  - `GitHubBacklogAutomationProvider` implementation with full webhook/API integration
  - `SubjectResolver` interface and strategy pattern for pluggable resolution logic
  - `LinkedPullRequestsResolver` with smart auth detection (fetch PR metadata when available, fallback gracefully)
  - `SubjectResolverChain` executor with configurable strategy ordering
  - Full async/await support for network operations

  Maintains full backward compatibility with Phase A infrastructure while enabling Phase C evidence generation.

  **Tests:** All 165+ tests pass. 23 new tests for provider and resolver abstractions.

  **Acceptance:** All Phase B acceptance criteria met.

- 067b261: feat(210-phase-c): Add evidence generation mode refinements

  **Phase C: Evidence Generation Mode**

  Improves backlog scan evidence generation with safer record behavior:

  - Timestamp-based evidence record naming (`record-YYYYMMDD-HHMMSS-{work-item-id}.md`)
  - Idempotency guard that reuses existing linked evidence records instead of creating duplicates
  - Updated scan tests for timestamped evidence IDs and idempotent repeat runs
  - Added evidence records reference documentation and fixed related scan CLI docs link
  - Marked Phase C work item artifacts as ready-for-review

  **Validation:** docs lint passes, backlog validate CI passes, backlog scan tests pass.

- 025fe96: feat(210-phase-d): convert backlog sweep workflow to thin wrapper

  Phase D updates the backlog sweep workflow to invoke `doc-vader backlog scan --generate-evidence` as a thin wrapper and uploads a JSON scan report artifact (`backlog-scan-report-{run-id}`).

  Also adds troubleshooting runbook guidance for retrieving and debugging scan failures via workflow artifacts.

- e8606de: feat(210-phase-e): add strict mode and consumer config resolver order

  Phase E adds:

  - `automation.subjectResolutionOrder` support in consumer config (`backlog-consumer.json`)
  - Resolver order precedence: CLI flag > consumer config > built-in default
  - `ConsumerAutomation.subjectResolutionOrder` field in work-management types
  - Configuration tests covering all precedence paths and strict mode behavior
  - `docs/reference/work-management/backlog-scan-configuration.md` reference guide

  `--strict` and `--resolver-order` CLI flags were already wired in Phase A; this phase connects consumer config fallback to complete the configuration system.

- ec98aaf: Add missing direct dependencies required by plugin and processor modules: `unified-lint-rule`, `unist-util-visit-parents`, `vfile`, `zod`, `@types/mdast`. Add `tsx` as dev dependency for docs-lint script runtime. These were previously resolved transitively but must be declared explicitly per semver contract.
- 0e4d976: feat(228): sweep validate and archive candidates

  Story 228 implements end-to-end candidate validation and archival orchestration:

  - Extended `BacklogScanOptions` and `BacklogScanReport` with candidate validation fields
  - Added `ConsumerAutomation` config options for `validateArchiveCandidates` and `invalidCandidateStatus`
  - Implemented candidate discovery, validation, and archival flow in scan executor
  - Created `work-item-validation` utilities with archive readiness and closure evidence checks
  - Added remark-lint rules for archive prerequisites and closed-item metadata validation
  - Extended scan reporter to display candidate validation metrics
  - Updated scan-report JSON schema with candidate validation properties
  - Enabled feature in backlog-sweep workflow
  - Added 3 comprehensive integration tests covering normal flow, discrepancy handling, and CLI overrides
  - All 30 backlog scan tests passing

- c9952b2: Complete remark-lint unification with --fail-on error/warning policy control and --format text/json output modes. Implement missing 171-series features for docs-remark-lint.ts and staging scripts/docs-lint.sh wrapper. Close 171 feature and all supporting tasks (171.2, 171.2.2, 171.2.3, 171.2.4) as complete with acceptance criteria met.

### Patch Changes

- 08ca685: Backlog sweep candidate validation now auto-generates and links missing evidence for ready-for-review/closed work items before archive-readiness checks, reducing false no-op sweeps when evidence links are absent.
- febec3e: Add a helper script to bootstrap direct-push backlog automation setup for local/operator execution.
- 498340c: Fix cross-reference resolution in the unified remark lint pipeline, add a repo-local examples landing page, and rename the security policy document to kebab-case. Also update docs lint configuration for Node.js v25 compatibility.
- 8c193a4: Move `gray-matter` from devDependencies to dependencies. It is imported by published lib modules (`backlog`, `frontmatter`, `docs`, `diataxis`, `work-management`) and must be present at runtime when the package is installed as a global CLI.
- 37f9a98: Add inbound-reference guard to backlog scan: archival of a work item is now blocked when any active backlog file references it via a wikilink. The resolver supports same-folder and nested-subfolder lookup, sorting candidates alphabetically then by depth distance from the source file.
- 8db5fbd: chore(backlog): close phase b and verify phase c validation

  - close Phase B work item metadata after merged delivery (`status: closed`, `status_reason: completed`, `completed_date`)
  - complete Phase C validation checklist based on passing evidence-generation test coverage
  - add timestamped verification note documenting focused validation evidence

- 0b041af: feat(210-phase-b): complete resolver condition and error taxonomy

  Adds the remaining Phase B condition and error taxonomy to the backlog scan pipeline:

  - `subject_resolved` condition reports whether the resolver chain found subjects for a work item
  - `valid_evidence` condition validates that the evidence links block is present and populated
  - `resolve_subject_failed` error captures resolver strategy failures
  - `fetch_pr_metadata_failed` error captures linked-PR metadata fetch failures

  Structured resolver failure reporting now propagates attempt-level errors to the scan report with strategy-typed codes, enabling downstream consumers to distinguish PR-metadata failures from generic resolution failures.

  **Tests:** All scan, provider, and resolver tests pass. New assertions added for `subject_resolved` condition and taxonomy coverage.

- d405e40: chore(backlog): close phase c and advance phase d validation

  - close Phase C work item metadata after merged delivery with completion evidence note
  - record verified Phase D workflow validation (no embedded Python invocations remain)
  - document the current runtime-validation blocker when backlog automation sweep is skipped

- 8c69686: fix(backlog-scan): align Phase A checklist evidence with implementation

  Adds missing scan-report schema and fixture-backed validation evidence for Phase A scan work, plus condition/event metadata coverage in scan reporting.

- 6f3dc2c: feat(backlog): add configurable pre-push validation policy and docs
- 41a9a55: Fix candidate discrepancy accounting after evidence generation refresh by preserving archive flow and counting inbound-reference discrepancies correctly in backlog scan reporting.
- 8232e0e: split backlog frontmatter remediation changes from oversized PR into dedicated reviewable unit.
- e183274: split docs-only frontmatter normalization changes from oversized PR into dedicated reviewable unit.
- 725a277: Improve backlog scan reliability and CI compliance:

  - handle per-file read errors without aborting the full report
  - normalize report paths across platforms
  - skip `backlog/archive` by default with optional include flag
  - make scan reporter tests deterministic

- a80bdef: fix(backlog): handle list-of-maps PR link format in linkedPullRequestsResolver
- 7a5f7d1: Allow backlog sweep evidence backfill for `wi-*` work-item IDs and add regression coverage for wi-prefixed archive candidates; also set test script to run in non-watch mode for CI-safe local invocations.

All notable changes to `doc-vader` will be documented in this file.

This project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases are managed with [Changesets](https://github.com/changesets/changesets).

## [Unreleased]

### Added

- CLI domains: `frontmatter`, `doc-system`, `backlog`, `work-item`, `record`, `governance`, and aggregate `validate`
- Backlog hygiene audit with `--fail-on`, `--profile`, and `--format` flags
- Work-item lifecycle commands: `transition`, `link`, `record-commit`, `finalize`
- Governance profile detection, reconciliation, and migration
- Diataxis framework validation and auto-fix
- Programmatic TypeScript API (`frontmatter`, `docs`, `backlog`, `workManagement`, `diataxis` modules)
- CI-safe validation profiles (`default`, `strict`, `ci`)
- VCS event ingestion via `backlog ingest-event`
