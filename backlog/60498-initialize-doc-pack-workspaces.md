---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60498
title: Initialize Document-Pack Workspaces
summary: Add the approved dv init vertical slice for declarative document-pack workspace setup.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
estimated: 3
links:
  depends_on:
    - '[[60449-implement-doc-pack-registry-and-conformance.md]]'
  reference:
    - '[[../docs/how-to/implementation-plans/doc-pack-registry-and-domain-pack-migration-prd.md]]'
  evidence:
    - '[[record-20260921-195524-60498]]'
tags:
  - document-packs
  - afk
---

## Goal

Provide `dv init` for the bundled Work document pack and static, already-installed
extension pack descriptors without changing runtime claims or package lifecycle.

## Tasks

- [ ] Select packs interactively or with repeatable `--pack`, supporting `--yes`,
      `--dry-run`, and JSON output.
- [ ] Validate and apply core-owned declarative init recipes at the Git root or
      explicit target, preserving unrelated root `dv.yaml` content.
- [ ] Create the empty tracked Work backlog layout with no sample work items.
- [ ] Reject unsafe paths, unclaimed config writes, config/output collisions, and
      symlink escapes; roll back a failed pack independently.
- [ ] Document the static installed-package descriptor convention and add focused
      tests.

## Acceptance Criteria

- [ ] `DocPackRegistry` remains catalog-only and no extension code is executed.
- [ ] The Work recipe creates only the tracked `backlog/` layout and targeted
      `dv.yaml` configuration.
- [ ] Focused tests, typecheck, documentation lint, and backlog validation pass.
