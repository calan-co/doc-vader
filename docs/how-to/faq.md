---
title: Frequently Asked Questions (FAQ)
status: approved
lastReviewed: 2026-04-27T00:00:00.000Z
description: Answers to common questions about doc-vader.
id: faq
type: document
subtype: reference
lifecycle: active
---

## General

- **What is doc-vader?**
  - `doc-vader` is a CLI and TypeScript library for documentation validation, backlog hygiene auditing, and governance enforcement in Markdown-based projects.

- **Who should use doc-vader?**
  - Engineering and documentation teams that manage structured Markdown docs and work-item backlogs, especially across multiple repositories.

## Installation & Setup

- **How do I install doc-vader?**
  - See [Getting Started](./getting-started.md) for installation instructions.

- **What are the system requirements?**
  - Node.js ≥ 22, pnpm 8 (for development).

- **The registry install fails — what do I do?**
  - Ensure your `.npmrc` includes `@calan-co:registry=https://npm.pkg.github.com` and that you are authenticated with `npm login --scope=@calan-co --registry=https://npm.pkg.github.com`.

## Usage

- **How do I run validation in CI?**
  - Use `doc-vader backlog validate --profile ci --fail-on error`. This returns a non-zero exit code on any error-level finding and outputs machine-readable JSON with `--format json`.

- **Can I use doc-vader as a library?**
  - Yes. Import `frontmatter`, `backlog`, `docs`, `workManagement`, or `diataxis` from `@calan-co/doc-vader`.

- **What is a consumer config?**
  - A JSON file that overrides default path resolution and schema routing for `work-item`, `backlog`, and `record` commands. Pass it with `--consumer-config <path>`.

## Troubleshooting

- **See [Troubleshooting](./troubleshooting.md) for common error messages and fixes.**
