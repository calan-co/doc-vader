---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60523
title: Clean Stale Jsonschema Tools References And Enforce Conventional Commits
summary: Remove stale jsonschema-tools wording while retaining live integrations, and make the commit-msg hook validate its actual message file.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: recoverable
priority: medium
links:
  reference:
    - '[[60377-work-item-governance-kernel]]'
tags:
  - afk
  - tech-debt
  - tooling
---

## Goal

Keep only live jsonschema-tools references and enforce the repository's existing Conventional Commit policy from the Husky commit-msg hook.

## Tasks

- [ ] Classify jsonschema-tools references as live implementation/test dependencies or stale wording.
- [ ] Remove or neutralize stale wording without rewriting historical evidence.
- [ ] Correct commit-msg argument handling so commitlint receives the hook message file.
- [ ] Add focused regression coverage for accepted and rejected Conventional Commit messages.

## Acceptance Criteria

- [ ] Live jsonschema-tools package, hook, and test integrations remain functional; stale active wording is removed.
- [ ] A Conventional Commit message passes and an invalid message fails through the repository hook command.
- [ ] Focused tests, lint, typecheck, documentation/backlog validation, and pre-push validation pass.
