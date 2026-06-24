---
id: wi-60375
title: Lock Path Normalization and Rename Gate
summary: Implement deterministic repo-relative lock path normalization, SHA-256 lock keys, and MVP rename rejection.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: critical
estimated: 4
actual: 4
completed_date: '2026-06-20'
links:
  depends_on:
    - '[[60362-runtime-sqlite-store-and-migrations]]'
    - '[[60363-runtime-entity-schemas]]'
  reference:
    - '[[60340-artifact-graph-and-nested-claim-architecture-adr]]'
    - '[[60361-git-sqlite-local-multi-agent-runtime-contract]]'
  evidence:
    - '[[task-record-preflight]]'
    - '[[record-sandcastle-task-validation-passed]]'
tags:
  - afk
  - runtime
  - locks
  - git
---

## Goal

Implement the MVP file-path identity rules used by lock creation and changed-file audits.

## Background

MVP lock identity is a normalized repo-relative file path emitted by the file storage adapter boundary. Paths do not need to exist before locking. Future granular artifacts may suffix the normalized path, but typed artifact refs and directory locks are out of MVP. Git-detected renames are rejected until an explicit move operation is designed.

Architectural context: `docs/architecture/decisions/adr-009-storage-and-format-seams.md`.

## Tasks

- [x] Resolve input paths against the current working directory and repository root.
- [x] Reject paths that escape the repository root.
- [x] Normalize to POSIX repo-relative path strings.
- [x] Normalize `.` and `..` segments.
- [x] Anchor casing to Git `core.ignorecase`.
- [x] When `core.ignorecase=true`, canonicalize existing tracked path components from the Git index where possible.
- [x] Preserve caller-provided casing for new path segments.
- [x] Preserve exact casing when `core.ignorecase=false`.
- [x] Compute `locks.key` as SHA-256 over UTF-8 `locks.path`.
- [x] Reject directory lock targets in MVP.
- [x] Detect Git renames and case-only renames in changed-file audit input.
- [x] Fail terminal success when renames are detected, returning structured diagnostics.

## Deliverables

- [x] Lock path normalization helper.
- [x] Lock key helper.
- [x] Rename detection diagnostics for lifecycle audits.
- [x] Tests for relative paths, absolute paths, non-existing paths, casing, repo escape, directory rejection, and renames.

## Acceptance criteria

- [x] Absolute and relative references to the same file normalize to the same `locks.path`.
- [x] Non-existing file paths can be locked when their normalized identity is inside the repo.
- [x] Case normalization follows `core.ignorecase`.
- [x] `locks.key` is stable SHA-256 of normalized path identity.
- [x] Directory locks are rejected.
- [x] Git-detected renames block terminal success in MVP.

## Blocked by

- [[60362-runtime-sqlite-store-and-migrations]]
- [[60363-runtime-entity-schemas]]
