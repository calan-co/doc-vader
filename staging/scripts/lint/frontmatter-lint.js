#!/usr/bin/env node
/**
 * @precommitRule Validates markdown frontmatter against the correct schema for docs and backlog.
 * @note Canonical required fields/types/enums are now enforced by JSON schemas (see schemas/).
 * @note This script only runs schema validation and does not duplicate any field/type logic.
 */

// frontmatter-lint.js
// Validates markdown frontmatter against the correct schema for docs and backlog
// Usage:
//   node frontmatter-lint.js                # Validate all docs and backlog
//   node frontmatter-lint.js file1.md ...    # Validate specific files
//   node frontmatter-lint.js dir1 dir2 ...   # Validate all .md files in specified dirs

const fs = require("fs");
const path = require("path");
const selectSchema = require("../utils/selectSchema");
const {
  extractFrontmatter,
  validateFrontmatter,
} = require("../utils/frontmatter");
let sessionContext;
try {
  sessionContext = require("../../team-in-a-box-backend/src/services/sessionContextService");
} catch (_) {}

function getMarkdownFilesFromDirs(dirs) {
  const files = [];
  for (const dir of dirs) {
    walk(dir, files);
  }
  return files;
}
function walk(dir, files) {
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    if (fs.statSync(fp).isDirectory()) walk(fp, files);
    else if (f.endsWith(".md")) files.push(fp);
  }
}

function main() {
  const args = process.argv.slice(2);
  let files = [];
  for (const arg of args) {
    const p = path.resolve(process.cwd(), arg);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      files.push(...getMarkdownFilesFromDirs([p]));
    } else if (fs.existsSync(p) && p.endsWith(".md")) {
      files.push(p);
    }
  }
  if (files.length === 0) {
    console.log(
      "No markdown files found for validation. Pass files or directories as arguments."
    );
    process.exit(0);
  }
  let hasErrors = false;
  for (const file of files) {
    const frontmatter = extractFrontmatter(file);
    let valid = true;
    let errors = [];
    if (!frontmatter) {
      console.error(`Missing or malformed frontmatter: ${file}`);
      valid = false;
      errors = ["Missing or malformed frontmatter"];
      hasErrors = true;
    } else {
      const schemaPath = selectSchema(file, frontmatter);
      if (!schemaPath) {
        console.warn(`No schema found for: ${file}`);
      } else {
        errors = validateFrontmatter(frontmatter, schemaPath);
        if (errors.length) {
          console.error(`Frontmatter schema errors in ${file}:`);
          for (const err of errors) console.error("  " + err);
          valid = false;
          hasErrors = true;
        }
      }
    }
    if (sessionContext) {
      sessionContext.recordValidation(file, valid, errors, { valid, errors });
    }
  }
  if (hasErrors) process.exit(1);
  else console.log("✓ All markdown frontmatter valid against schemas");
}
if (require.main === module) main();
