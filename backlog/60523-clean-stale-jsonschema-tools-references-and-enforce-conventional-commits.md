---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60523
title: Clean Stale Jsonschema Tools References And Enforce Conventional Commits
summary: Remove stale jsonschema-tools wording while retaining live integrations, and make the commit-msg hook validate its actual message file.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: medium
completed_date: '2026-11-10'
commits:
  de10e6d1531b5943d46cf1291a8e00fb4f1d75a3: 'fix(work): restore honest prerequisite validation (WI-60523, WI-60527)'
links:
  reference:
    - '[[60377-work-item-governance-kernel]]'
  evidence:
    - '[[record-wi-60523-hook-validation-20261110]]'
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/130
tags:
  - afk
  - tech-debt
  - tooling
---

## Goal

Keep only live jsonschema-tools references and enforce the repository's existing Conventional Commit policy from the Husky commit-msg hook.

## Tasks

- [x] Classify jsonschema-tools references as live implementation/test dependencies or stale wording.
- [x] Remove or neutralize stale wording without rewriting historical evidence.
- [x] Correct commit-msg argument handling so commitlint receives the hook message file.
- [x] Add focused regression coverage for accepted and rejected Conventional Commit messages.

## Acceptance Criteria

- [x] Live jsonschema-tools package, hook, and test integrations remain functional; stale active wording is removed.
- [x] A Conventional Commit message passes and an invalid message fails through the repository hook command.
- [x] Focused tests, lint, typecheck, documentation/backlog validation, and pre-push validation pass.
