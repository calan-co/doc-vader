---
title: Docs → Wiki Sync
summary: One-way sync from BAIT docs to GitHub Wiki with Obsidian wikilink support.
docType: guide
phase: evergreen
audience:
  - contributors
id: template
type: work-item
subtype: template
lifecycle: draft
status: proposed
---

## Overview

This repository publishes selected documentation to the GitHub Wiki for public browsing.
The sync is one-way (primary repo → wiki). During publish, Obsidian-style wikilinks are
rewritten to standard Markdown so links render correctly on the wiki.

- Primary repo: `squirrel289/BAIT`
- Wiki repo: `squirrel289/BAIT.wiki`
- Workflow: `.github/workflows/wiki-sync.yml`

## How it works

1. Checkout both repos (full history) on push to `main` or via manual dispatch.
2. Copy from `docs/` into the wiki working tree using a filtered rsync (only Markdown and images).
3. Rewrite Obsidian wikilinks/embeds in the copied files to GitHub-compatible Markdown.
4. Ensure `Home.md` and `_Sidebar.md` exist for a friendly wiki UI.
5. Commit inside the wiki working tree and push to the wiki’s `master` branch (the branch the wiki UI serves).
6. Safety gate: the job fails if any changes occur outside the `wiki/` directory, preventing leakage back into the primary repo.

## File selection

Included from `docs/`:

- `*.md` (Markdown files)
- Images: `*.png`, `*.jpg`, `*.jpeg`, `*.gif`, `*.svg`, `*.webp`
- Documents: `*.pdf`
- Directory structure is preserved under the wiki root

Excluded:

- Everything else (`--exclude='*'`)

## Wikilink rewriting (Obsidian → Markdown)

Transformer: `scripts/wiki-wikilink-rewriter.js`

Supported conversions:

- Links
  - `[[Page]]` → `[Page](Page.md)`
  - `[[folder/Page]]` → `[Page](folder/Page.md)`
  - `[[Page|Alias]]` → `[Alias](Page.md)`
  - `[[Page#Heading]]` → `[Heading](Page.md#heading)`
  - `[[Page#Heading|Alias]]` → `[Alias](Page.md#heading)`
  - `[[file.md]]` → `[file](file.md)`
  - `[[document.pdf]]` → `[document](document.pdf)`
- Images/embeds
  - `![[image.png]]` → `![image](image.png)`
  - `![[diagram.svg]]` → `![diagram](diagram.svg)`
  - `![[folder/image.png|100x100]]` → `![image](folder/image.png)` (size hint ignored)

Resolution rules for bare names:

- Prefer same-folder match; else a unique global match by basename; else the shortest path
- Headings are slugified to GitHub-style anchors: lowercased, spaces→`-`, punctuation removed

Known limitations:

- Obsidian block refs (e.g., `^block-id`) are not supported on GitHub and are stripped
- Ambiguous filenames across folders may resolve to the shortest path if no same-folder match exists

## One-way guarantee

- The rewriter runs against the `wiki/` working tree only
- The workflow includes a safety gate that aborts if any non-wiki file is modified
- The action pushes exclusively to the wiki repo (`master` branch)

## Optional: Two-way sync (OFF by default)

If two-way sync is enabled later, use the reverse transformer to convert Markdown
back to Obsidian-style wikilinks when syncing from the wiki → primary repo.

Reverse transformer (scaffold): `scripts/wiki-wikilink-reverse.js`

- Links
  - `[Text](folder/Page.md)` → `[[folder/Page|Text]]` (or `[[folder/Page]]` if `Text` ≈ `Page`)
  - `[Text](Page.md#heading)` → `[[Page#heading|Text]]`
  - `[Page](Page.md)` → `[[Page]]`
- Images
  - `![alt](image.png)` → `![[image.png]]`

Caveats:

- Anchor names are left as slugs (we cannot reliably recover original heading capitalization)
- External links (`http:`, `https:`, `mailto:`, `data:`) remain unchanged

## Permissions

- The workflow uses `GH_WIKI_TOKEN` with write access to `squirrel289/BAIT.wiki` only
- Do not grant write access to the primary repo to maintain the one-way guarantee

## Troubleshooting

- Wiki renders empty
  - Ensure `Home.md` exists (workflow creates it from `docs/README.md` if present)
  - Verify pushes go to the wiki’s `master` branch (UI serves `master`)
- Links show as plain text or 404
  - The transformer runs only on the wiki copy; ensure the workflow completed and committed
  - For nested pages, prefer explicit paths in source wikilinks: `[[prd/README|PRD]]`
- Runner log contains `cannot delete non-empty directory: .git/...`
  - The workflow protects `.git/` during rsync via `--filter='P .git/'`

## Manual usage (optional)

Run a one-off conversion locally against a wiki working folder:

```sh
node scripts/wiki-wikilink-rewriter.js wiki
or reverse (not wired into CI)
==============================node scripts/wiki-wikilink-reverse.js wiki
```
