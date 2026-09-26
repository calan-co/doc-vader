# Changelog

## 0.1.0

### Minor Changes

- f3ad110: Make backlog scan subject matching and candidate validation rules configurable through `.doc-vader/backlog-consumer.json`.

  - Add configurable work item token prefixes via `automation.workItemMatchPatterns`.
  - Add configurable pull request link extraction path via `automation.pullRequestPath`.
  - Add configurable candidate validation requirements via `automation.requiredCandidateFields`.
  - Add unit, integration, and e2e coverage for config-driven behavior.
  - Document the new configuration keys in backlog scan reference docs.

- c066147: Add the doc-pack manifest contract, Phase 1 inventory verifier, and conformance fixtures.
- ebc7404: Add the catalog-only DocPackRegistry and doc-pack conformance validation.
- c3e1724: Add canonical document-pack routing contracts, schemas, and extension authoring guidance.
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

- 9d96b01: Add deterministic governance reconciliation support for RC execution and improve backlog validation profile handling.

  - Add multi-profile support to `backlog validate` with deterministic merge behavior and profile trace output in audit options.
  - Replace placeholder governance reconciliation with a deterministic `priority-order` strategy and machine-readable conflict/decision trace.
  - Use robust YAML frontmatter parsing for governance detection/reconciliation paths.
  - Align frontmatter document schema variants to accept `status: ready` for active and evergreen lifecycle states used by backlog work items.

- ec98aaf: Add missing direct dependencies required by plugin and processor modules: `unified-lint-rule`, `unist-util-visit-parents`, `vfile`, `zod`, `@types/mdast`. Add `tsx` as dev dependency for docs-lint script runtime. These were previously resolved transitively but must be declared explicitly per semver contract.
- 45c355e: Add Sandcastle-ready work planning, inspection, recovery, and smoke-test surfaces.
- d11e351: Integrate Sandcastle runtime, task governance, and evaluation workflows.
- 9880a3e: feat(backlog): Phase B resolver-chain scaffolding with `--resolver-order` CLI flag
- 0871a57: Implement remark-frontmatter-schema plugin for unified frontmatter validation

  - Add Ajv-backed remark-frontmatter-schema plugin supporting strict/non-strict modes
  - Integrate plugin into .remarkrc.mts Layer 1 for early frontmatter validation
  - Support caching strategy keyed by file path + mtime
  - Enable type-specific schema resolution from schemas/frontmatter/ directory
  - Comprehensive test coverage (8 tests) with all passing

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
- 5780fbd: Add Sandcastle-oriented work graph commands, runtime slices, and graph visualization/export review fixtures.

### Patch Changes

- 08ca685: Backlog sweep candidate validation now auto-generates and links missing evidence for ready-for-review/closed work items before archive-readiness checks, reducing false no-op sweeps when evidence links are absent.
- febec3e: Add a helper script to bootstrap direct-push backlog automation setup for local/operator execution.
- 423a484: Add local pre-push validation for release-relevant changesets and malformed changeset frontmatter.
- b291b98: Add a manual, bounded Windows Node 22 diagnostic probe surface.
- 077f889: Disable automatic CodeRabbit pull-request reviews while retaining explicit manual review requests.
- a99b753: Prefer the `dv` command surface in agent-facing guidance and local validation wrappers.
- 8f79506: feat(epic-170): cross-file registry model doc and unified processor test suite (WI-228, WI-229)

  - Add `docs/reference/cross-file-registry-model.md`: defines `RegistryNode`, `ProjectRegistry` interface, resolution algorithm, cache semantics, error reporting, and integration points for Epic 170 Track C plugins
  - Add `tests/processor.test.ts`: 19-test suite covering `createTiabProcessor` composition, checklist/templateCompliance/crossref plugin wiring, instance isolation, and Epic 170 Phase 1 exit-gate baseline

- 4ed1b36: feat(epic-210): canonical schema integration — TypeBox config, DRY schema resolver, JSON-LD vocabulary support

  - Add `lib/config/schema.ts`: TypeBox-based config schemas (`DocVaderConfigSchema`, `VocabularyConfigSchema`, etc.)
  - Add `lib/config/loader.ts`: `ConfigLoader` class to load and validate `.doc.json`
  - Add `lib/schema/resolver.ts`: DRY `resolveSchema` / `resolveVocabularyContext` with 4-level precedence
  - Update `lib/backlog/audit.ts`, `lib/frontmatter/lint.ts` to use `resolveSchema`
  - Add `@context` / `@type` optional properties to frontmatter document schema (current, 1.0.0, latest)
  - Add `contexts/document.jsonld` and `contexts/work-item.jsonld` (JSON-LD vocabulary mappings)
  - Add `.doc.json` root config with `schemaMap` and `vocabularies`
  - Add `schemas/README.md` documenting versioning and `$id` conventions
  - Remove `$versioningScheme` from document schema files (WI-211)

- 498340c: Fix cross-reference resolution in the unified remark lint pipeline, add a repo-local examples landing page, and rename the security policy document to kebab-case. Also update docs lint configuration for Node.js v25 compatibility.
- 8c193a4: Move `gray-matter` from devDependencies to dependencies. It is imported by published lib modules (`backlog`, `frontmatter`, `docs`, `diataxis`, `work-management`) and must be present at runtime when the package is installed as a global CLI.
- 60b35e1: Use `staging` as the changeset validation base branch.
- 72c8873: Add the greenfield Sandcastle workflow foundation and backlog plan.
- 904dcc8: Harden `dv init` path handling, idempotent output writes, configuration edits, and terminal diagnostics.
- 12969e1: Honor explicitly disabled template-compliance configurations during documentation validation.
- 7442830: wire remark-frontmatter-schema plugin into unified processor
- 37f9a98: Add inbound-reference guard to backlog scan: archival of a work item is now blocked when any active backlog file references it via a wikilink. The resolver supports same-folder and nested-subfolder lookup, sorting candidates alphabetically then by depth distance from the source file.
- a4c159e: Align work-management lifecycle schemas and backlog automation with canonical active statuses.

  - Resolve archive scan roots from consumer configuration.
  - Keep versioned frontmatter schemas pinned to versioned schema refs.
  - Preserve archived/legacy compatibility without allowing it to bloat active work-item status handling.

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
- 101482e: Publish the resource-scoped, versioned work-selection transport and Node 20 consumer decoder.
- ebc011c: Harden backlog and Sandcastle automation state handling while preserving guarded work-item closure semantics.
- 2a8a3e4: Fix the Windows Node 22 diagnostic runner to launch Corepack's pnpm shim and fail closed when setup cannot execute.
- 71003b3: Recover dropped backlog remediation updates by removing inbound-reference archive blocking from backlog scan, updating scan tests to match archival behavior, and restoring backlog metadata needed for archive-candidate readiness.
- 41a9a55: Fix candidate discrepancy accounting after evidence generation refresh by preserving archive flow and counting inbound-reference discrepancies correctly in backlog scan reporting.
- ce5e4dc: Tighten registry fixture contract coverage in the processor test suite.
- 2f75314: Run Sandcastle sandbox pnpm hooks in CI mode and stabilize task CLI integration tests on slower Windows runners.
- 423a484: Harden Sandcastle dogfood orchestration with conventional commit prompts, heartbeat validation commands, bounded idle timeouts, and no-commit claim release.
- 423a484: Run Sandcastle sandbox install and build setup as one ordered hook so build cannot race dependency installation, and make Sandcastle prompt adapter commands non-interactive.
- 8f203b8: Harden Sandcastle runtime configuration and restore active staging lint support.
- fc23388: Add schema-backed PRD validation and rendering lifecycle commands.
- 8232e0e: split backlog frontmatter remediation changes from oversized PR into dedicated reviewable unit.
- e183274: split docs-only frontmatter normalization changes from oversized PR into dedicated reviewable unit.
- 870304d: Fix task command review issues around claim locking, template rendering, adapter payload handling, and Windows CLI test execution.
- 725a277: Improve backlog scan reliability and CI compliance:

  - handle per-file read errors without aborting the full report
  - normalize report paths across platforms
  - skip `backlog/archive` by default with optional include flag
  - make scan reporter tests deterministic

- 13d3b59: Treat test-only changes as release-neutral in changeset validation.
- 848e715: Update the declared pnpm package manager version to 11.9.0.
- 16328d6: Allow generated version branches and completed unestimated work items through their validated release gates.
- a80bdef: fix(backlog): handle list-of-maps PR link format in linkedPullRequestsResolver
- 7a5f7d1: Allow backlog sweep evidence backfill for `wi-*` work-item IDs and add regression coverage for wi-prefixed archive candidates; also set test script to run in non-watch mode for CI-safe local invocations.
- ff25b4e: Apply Windows-only timeout headroom (15s on win32 vs 5s elsewhere) to the Git and SQLite integration tests, disable Vitest test-file parallelism on Windows, and remove obsolete globally hoisted memfs mocks from Vitest setup.
- c18ca98: Improve work-item completion criteria section parsing.
- eab7966: Require implementation pull requests to link one completed Work item before merge.
- 16150d0: Relax closed-work-item frontmatter requirements and align pre-push schema materialization flow to unblock CI and hook validation.

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
