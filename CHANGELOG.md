# Changelog

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
