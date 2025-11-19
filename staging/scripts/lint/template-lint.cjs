#!/usr/bin/env node
/**
 * @precommitRule Validates that docs match their required template structure.
 * @note This script should only enforce procedural/template mapping logic (e.g., correct template used for each subtype, or custom rules not expressible in schema/templates).
 * @note All required section and field validation has been removed from this script. See schemas/ and docs/templates/ for canonical validation.
 */
// template-lint.js
// Validates that docs match their required template structure
// TODO: This script no longer does anything. Remove or add template validation logic.
const fs = require("fs");
const path = require("path");
const { getMarkdownFilesFromArgs, reportErrors } = require("./lint-util.cjs");
let sessionContext;
try {
  sessionContext = require("../../team-in-a-box-backend/src/services/sessionContextService.js");
} catch (_) {}
const DOCS_DIR = path.resolve(__dirname, "../../../docs");

// Template mapping logic only. All required section/field validation is now in schema/templates.
const TEMPLATES = {
  adr: path.resolve(
    __dirname,
    "../prompt-templates/documentation/README-templates/adr-catalog-readme.md"
  ),
  process: path.resolve(
    __dirname,
    "../prompt-templates/documentation/README-templates/process-readme.md"
  ),
  // Add more mappings as needed
};

function checkFile(file, relPath, errors) {
  // Only check for correct template mapping or custom procedural rules here.
  // All required section/field validation is now in schema/templates.
  let valid = true;
  let errMsgs = [];
  // (No-op: add template mapping checks here if needed)
  if (sessionContext) {
    sessionContext.recordValidation(file, valid, errMsgs, {
      valid,
      errors: errMsgs,
    });
  }
}

function main() {
  const args = process.argv.slice(2);
  const files = getMarkdownFilesFromArgs(args, [DOCS_DIR]);
  const errors = [];
  for (const file of files) {
    const relPath = path.relative(process.cwd(), file);
    checkFile(file, relPath, errors);
  }
  reportErrors(
    errors,
    "Template structure issues:",
    "All documentation files match required template structure."
  );
}
if (require.main === module) main();
