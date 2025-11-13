---
# yaml-language-server: $schema=../schemas/work-item.frontmatter.schema.json
id: wi-003
title: Extend Diataxis Fixer to Auto-Generate Missing Frontmatter
type: work-item
subtype: tooling
lifecycle: active
status: proposed
priority: low
classification:
  diataxis: how-to
  sensitivity: internal
tags: [doc-vader, docs, automation, frontmatter]
---

**Estimated Effort:** 3-4 hours  
**Priority:** Low (developer convenience)  
**Assignee:** TBD  
**Depends On:** None (independent tooling task)

## Overview

Extend `scripts/fix-docs-diataxis.mjs` to automatically generate minimal valid frontmatter for docs that are missing it, reducing manual setup friction for documentation authors.

## Context

- Validator is strict-by-default and fails on missing frontmatter
- Moving docs manually and writing frontmatter is tedious
- Need smart defaults based on filename and folder location
- Must remain idempotent (don't duplicate existing frontmatter)

## Checklist

### Core Functionality

- [ ] Add `--write-frontmatter` CLI flag
- [ ] Add `--type <document|work-item>` CLI flag (default: document)
- [ ] Detect files with missing/empty frontmatter
- [ ] Generate frontmatter template based on type
- [ ] Preserve existing frontmatter when present
- [ ] Support dry-run mode with frontmatter preview

### Frontmatter Generation Logic

- [ ] Generate unique ID:
  - [ ] Format: `docs-<slug>` for documents
  - [ ] Format: `wi-<slug>` for work-items
  - [ ] Slug from filename (kebab-case, strip extension)
- [ ] Generate title from filename:
  - [ ] Convert kebab-case to Title Case
  - [ ] Replace hyphens/underscores with spaces
  - [ ] Strip file extension
- [ ] Infer diataxis from folder:
  - [ ] If in `docs/tutorial/` → `diataxis: tutorial`
  - [ ] If in `docs/how-to/` → `diataxis: how-to`
  - [ ] If in `docs/reference/` → `diataxis: reference`
  - [ ] If in `docs/explanation/` → `diataxis: explanation`
  - [ ] Default: `diataxis: explanation`
- [ ] Set schema directive:
  - [ ] Document: `$schema=./schemas/document.frontmatter.schema.json`
  - [ ] Work-item: `$schema=./schemas/work-item.frontmatter.schema.json`
  - [ ] Compute correct relative path from file location
- [ ] Set reasonable defaults:
  - [ ] `lifecycle: active`
  - [ ] `status: accepted`
  - [ ] `classification.sensitivity: public`
  - [ ] `tags: [linkity, docs]`
  - [ ] `subtype: general`

### Path Handling

- [ ] Handle files not in diataxis folders:
  - [ ] Move to `docs/explanation/` by default
  - [ ] Or to inferred diataxis folder if type can be guessed
- [ ] Calculate correct relative schema paths:
  - [ ] `docs/*.md` → `./schemas/...`
  - [ ] `docs/tutorial/*.md` → `../schemas/...`
  - [ ] `docs/decisions/*.md` → `../schemas/...`

### Template Structure

```yaml
---
# yaml-language-server: $schema=<relative-path-to-schema>
id: <generated-id>
title: <humanized-title>
type: <document|work-item>
subtype: general
lifecycle: active
status: accepted
classification:
  diataxis: <inferred-or-explanation>
  sensitivity: public
tags: [linkity, docs]
---
```

### Testing & Validation

- [ ] Test dry-run output format
- [ ] Test actual frontmatter insertion
- [ ] Verify generated frontmatter validates:
  - [ ] Run `npm run docs:validate` after generation
  - [ ] Schema directive paths resolve correctly
  - [ ] All required fields present
- [ ] Test idempotency (re-run doesn't duplicate)
- [ ] Test with files in different folder depths

### User Experience

- [ ] Print summary:
  - [ ] Files that will gain frontmatter
  - [ ] Files that will be moved
  - [ ] Generated ID and title preview
- [ ] Clear error messages for edge cases
- [ ] Document flags in script header comment
- [ ] Add usage examples to `.github/copilot-instructions.md`

## Success Criteria

✅ Script generates valid frontmatter that passes strict validation  
✅ Dry-run mode shows clear preview of changes  
✅ Idempotent: re-running doesn't corrupt existing frontmatter  
✅ Schema directive paths are correct from any folder depth  
✅ `npm run docs:validate` passes after generation  
✅ Title and ID generation is sensible and readable  
✅ Works for both document and work-item types

## Implementation Notes

### ID Generation Example

```javascript
function generateId(filePath, type) {
  const basename = path.basename(filePath, ".md");
  const slug = basename
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const prefix = type === "work-item" ? "wi" : "docs";
  return `${prefix}-${slug}`;
}
```

### Title Generation Example

```javascript
function generateTitle(filePath) {
  const basename = path.basename(filePath, ".md");
  return basename
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
```

### Relative Schema Path Calculation

```javascript
function getSchemaPath(fileFullPath, schemaFileName) {
  const fileDir = path.dirname(fileFullPath);
  const schemaPath = path.join(docsDir, "schemas", schemaFileName);
  const relative = path.relative(fileDir, schemaPath);
  return relative.replace(/\\/g, "/"); // normalize for YAML
}
```

### Frontmatter Insertion

```javascript
async function insertFrontmatter(filePath, frontmatter) {
  const content = await fs.readFile(filePath, "utf8");
  // Check if already has frontmatter
  if (content.startsWith("---")) return false;
  const updated = `---\n${frontmatter}\n---\n\n${content}`;
  await fs.writeFile(filePath, updated, "utf8");
  return true;
}
```

## Edge Cases to Handle

- [ ] Files with partial frontmatter (malformed YAML)
- [ ] Files with content but no frontmatter delimiter
- [ ] Binary files accidentally matched (skip)
- [ ] Files in subdirectories multiple levels deep
- [ ] Filename with special characters or spaces

## Commands

```bash
# Preview frontmatter generation
node scripts/fix-docs-diataxis.mjs --dry-run --write-frontmatter

# Generate frontmatter for documents (default)
node scripts/fix-docs-diataxis.mjs --write-frontmatter

# Generate frontmatter for work-items
node scripts/fix-docs-diataxis.mjs --write-frontmatter --type work-item

# Combined: move to correct folders AND add frontmatter
node scripts/fix-docs-diataxis.mjs --write-frontmatter

# Validate after generation
npm run docs:validate
```

## Follow-up Enhancements

- [ ] Interactive mode: prompt for title/diataxis if ambiguous
- [ ] Template customization via config file
- [ ] Batch update existing frontmatter fields
- [ ] Git commit automation for generated changes

## References

- `scripts/fix-docs-diataxis.mjs` - Script to extend
- `scripts/validate-frontmatter.mjs` - Validation logic
- `docs/schemas/document.frontmatter.schema.json` - Schema reference
- `docs/schemas/work-item.frontmatter.schema.json` - Schema reference
