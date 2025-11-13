/**
 * @precommitRule Custom remark-lint rules for documentation content.
 * @note Canonical required headings/sections are now enforced by JSON schemas and markdown templates (see schemas/ and docs/templates/).
 * @note This script only enforces custom/procedural rules not expressible in schema/templates (e.g., checklist unchecked tasks, cross-reference existence, API spec root key).
 * @note All required heading/section validation has been removed from this script. See schemas/ and docs/templates/ for canonical validation.
 */

const fs = require("fs");
const path = require("path");
const { extractFrontmatter } = require("../utils/frontmatter");

function validateChecklistTasks(content, errors) {
  // Require at least one task for checklists
  const regex = /- \[[xX ]\]/;
  if (!regex.test(content)) {
    errors.push("Checklists require at least one task (- [ ])");
  }
}

function validateCrossReferences(frontmatter, allFiles, errors) {
  if (!frontmatter.relations) return [];
  const missing = [];
  for (const rel of frontmatter.relations) {
    if (!allFiles.includes(rel.target)) missing.push(rel.target);
  }
  if (missing.length)
    errors.push(`Missing cross-references: ${missing.join(", ")}`);
}

function validateApiSpecSource(content, errors) {
  // Require openapi or asyncapi root key
  if (!content.includes("openapi:") && !content.includes("asyncapi:")) {
    errors.push("API spec missing openapi/asyncapi root key");
  }
}

function lintFile(filePath, allFiles) {
  const raw = fs.readFileSync(filePath, "utf8");
  const frontmatter = extractFrontmatter(raw);

  const errors = [];
  if (frontmatter.type === "checklist") validateChecklistTasks(raw, errors);
  // Cross-reference existence
  validateCrossReferences(frontmatter, allFiles, errors);
  // API spec: require openapi/asyncapi root key
  if (frontmatter.type === "api-spec") validateApiSpecSource(raw, errors);
  return errors;
}

function main() {
  const docsDir = path.resolve(__dirname, "../../docs");
  const allFiles = fs
    .readdirSync(docsDir, { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith(".md"))
    .map((f) => f.name);
  let hasErrors = false;
  for (const file of allFiles) {
    const filePath = path.join(docsDir, file);
    const errors = lintFile(filePath, allFiles);
    if (errors.length) {
      hasErrors = true;
      console.error(`\n${file}:`);
      for (const err of errors) {
        console.error(`  - ${err}`);
      }
    }
  }
  if (hasErrors) process.exit(1);
}

if (require.main === module) main();
