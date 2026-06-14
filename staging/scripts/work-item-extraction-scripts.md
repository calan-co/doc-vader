# Work Item Extraction Scripts

This document provides scripts for extracting key metadata and validation information from backlog work item files. Each script is presented in a code block with a description and usage instructions.

---

## 1. Extract Highest UniqueId

Extracts the highest uniqueId from all backlog work item filenames to help determine the next available id.

```sh
git ls-files 'backlog/*.md' | \
  grep -Eo '[0-9]+(\.[0-9]+)?' | \
  sort -n | tail -1
```

**Usage:**

- Run in your project root.
- Increment the result for the next work item uniqueId.

---

## 2. Extract Author (First Committer)

Gets the original author of a work item file from git history.

```sh
git log --format="%an" -- 'backlog/<filename>' | tail -1
```

**Usage:**

- Replace `<filename>` with your work item file.
- Returns the name of the first committer (author).

---

## 3. Extract Created Date

Gets the creation date of a work item file from git history.

```sh
git log --format="%ad" --date=short -- 'backlog/<filename>' | tail -1
```

**Usage:**

- Replace `<filename>` with your work item file.
- Returns the date of the first commit (creation).

---

## 4. Extract Last Updated Date

Gets the last updated date of a work item file from git history.

```sh
git log --format="%ad" --date=short -- 'backlog/<filename>' | head -1
```

**Usage:**

- Replace `<filename>` with your work item file.
- Returns the date of the most recent commit.

---

## 5. Validate Frontmatter Against Schema

Validates backlog work items against the repository backlog validation profile and centralized frontmatter schemas.

```sh
pnpm run backlog:validate
```

**Usage:**

- Run in your project root.
- Validates all backlog work item files using `schemas/frontmatter/by-type/work-item/latest.json` through the repository validation pipeline.

---

## 6. Extract Backlink Count (Markdown Link Graph)

Counts the number of backlinks to a work item file from other markdown files.

```sh
grep -r '\[\['"<filename>"'\]\]' backlog/ | wc -l
```

**Usage:**

- Replace `<filename>` with your work item file.
- Returns the number of times the file is referenced in other backlog markdown files.

---

## 7. Extract Review/Validation History

Lists all commits (reviews/updates) for a work item file.

```sh
git log --format="%ad %an %s" --date=short -- 'backlog/<filename>'
```

**Usage:**

- Replace `<filename>` with your work item file.
- Returns a chronological list of all commits (date, author, message).

---

## Notes

- All scripts assume you are running from the project root and have git installed.
- For validation, ensure your frontmatter is extracted as JSON or YAML before using ajv-cli.
- For advanced link graph analysis, consider using dedicated markdown link graph tools or custom scripts.
