#!/usr/bin/env node
// naming-conventions-lint.js
// Enforces documentation file naming conventions per documentation-decision-guide.md

const fs = require("fs");
const path = require("path");
const { getMarkdownFilesFromArgs, reportErrors } = require("./lint-util");
let sessionContext;
try {
  sessionContext = require("../../team-in-a-box-backend/src/services/sessionContextService");
} catch (_) {}
const DOCS_DIR = path.resolve(__dirname, "../../docs");
const SPECIAL = [
  "README.md",
  "CONTRIBUTING.md",
  "LICENSE.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
];
const WORK_ITEM_REGEX = /^\d+\..+\.md$/;
const APPROVALS_REGEX = /^\d+\.\d+-[a-z0-9-]+\.md$/;

function isKebabCase(filename) {
  return /^[a-z0-9]+(-[a-z0-9]+)*\.md$/.test(filename);
}

function checkFile(file, relPath, errors) {
  const base = path.basename(file);
  let valid = true;
  let errMsgs = [];
  if (SPECIAL.includes(base)) return;
  if (WORK_ITEM_REGEX.test(base)) return;
  // Allow epic.story-style filenames under docs/qa/approvals/
  if (relPath.startsWith(path.join("docs", "qa", "approvals") + path.sep)) {
    if (APPROVALS_REGEX.test(base)) return;
  }
  if (!isKebabCase(base)) {
    errors.push(`Non-compliant: ${relPath}`);
    valid = false;
    errMsgs.push("Non-compliant filename");
  }
  if (sessionContext) {
    sessionContext.recordValidation(file, valid, errMsgs, {
      valid,
      errors: errMsgs,
    });
  }
}

function main() {
  const args = process.argv.slice(2);
  let filesToCheck = [];
  if (args.length > 0) {
    // Only check files that were explicitly passed as arguments
    for (const arg of args) {
      const abs = path.resolve(process.cwd(), arg);
      if (
        fs.existsSync(abs) &&
        fs.statSync(abs).isFile() &&
        abs.endsWith(".md")
      ) {
        filesToCheck.push(abs);
      } else if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        // Only include .md files directly inside the directory (not recursive)
        for (const f of fs.readdirSync(abs)) {
          const fp = path.join(abs, f);
          if (fs.statSync(fp).isFile() && fp.endsWith(".md"))
            filesToCheck.push(fp);
        }
      }
    }
  } else {
    // No args: fallback to all .md files in docs recursively
    (function walk(dir) {
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f);
        if (fs.statSync(fp).isDirectory()) walk(fp);
        else if (fp.endsWith(".md")) filesToCheck.push(fp);
      }
    })(DOCS_DIR);
  }
  if (filesToCheck.length === 0) {
    console.log(
      "No markdown files found for validation. Pass files or directories as arguments."
    );
    process.exit(0);
  }
  // Debug: print files being checked
  // console.log('Files being checked:', filesToCheck);
  const errors = [];
  for (const file of filesToCheck) {
    const relPath = path.relative(process.cwd(), file);
    checkFile(file, relPath, errors);
  }
  const scopeMsg =
    args.length > 0 ? ` (scope: ${filesToCheck.length} file(s))` : "";
  reportErrors(
    errors,
    `Naming convention violations${scopeMsg}:`,
    `All documentation files${scopeMsg} comply with naming conventions.`
  );
}
if (require.main === module) main();
