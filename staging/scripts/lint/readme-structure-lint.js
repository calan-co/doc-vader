#!/usr/bin/env node

/**
 * @precommitRule Enforces README structure against templates.
 * @note Canonical required sections/headings are now enforced by JSON schemas and markdown templates (see schemas/ and docs/templates/).
 * @note This script only checks template mapping and procedural rules (e.g., correct template for each README location).
 */

const fs = require("fs");
const path = require("path");

// ANSI color codes
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

// README to template mappings
const README_TEMPLATES = {
  "docs/README.md":
    "prompt-templates/documentation/README-templates/docs-root-readme.md",
  "docs/guide/README.md":
    "prompt-templates/documentation/README-templates/guide-catalog-readme.md",
  "docs/architecture/decisions/README.md":
    "prompt-templates/documentation/README-templates/adr-catalog-readme.md",
  "docs/discovery/README.md":
    "prompt-templates/documentation/README-templates/discovery-readme.md",
  "docs/process/README.md":
    "prompt-templates/documentation/README-templates/process-readme.md",
  "docs/qa/README.md":
    "prompt-templates/documentation/README-templates/qa-overview-readme.md",
  "docs/qa/assessments/README.md":
    "prompt-templates/documentation/README-templates/qa-assessments-readme.md",
};

let hasErrors = false;

/**
 * Extract H1 and H2 headings from markdown content
 */
function extractHeadings(content) {
  const lines = content.split("\n");
  const headings = [];

  // If frontmatter present, use title as implicit H1
  if (content.startsWith("---")) {
    const end = content.indexOf("\n---\n", 4);
    if (end !== -1) {
      const frontmatter = content.substring(4, end + 1);
      const titleMatch = frontmatter.match(/^title:\s*(.+)$/m);
      if (titleMatch) {
        headings.push({ level: 1, text: titleMatch[1].trim() });
      }
    }
  }

  for (const line of lines) {
    const h1Match = line.match(/^# (.+)$/);
    const h2Match = line.match(/^## (.+)$/);

    if (h1Match) {
      headings.push({ level: 1, text: h1Match[1].trim() });
    } else if (h2Match) {
      headings.push({ level: 2, text: h2Match[1].trim() });
    }
  }

  return headings;
}

/**
 * Validate README headings against template
 */
// TODO: Either refactor to support all templates or migrate to third-party library like Markdoc
function validateReadme(readmePath, templatePath) {
  const filename = readmePath;

  // Check if README exists
  if (!fs.existsSync(readmePath)) {
    console.error(`${RED}✗${RESET} ${filename}: File not found`);
    hasErrors = true;
    return;
  }

  // Check if template exists
  if (!fs.existsSync(templatePath)) {
    console.warn(
      `${YELLOW}⚠${RESET} ${filename}: Template not found at ${templatePath}`
    );
    return;
  }

  const readmeContent = fs.readFileSync(readmePath, "utf8");
  const templateContent = fs.readFileSync(templatePath, "utf8");

  const readmeHeadings = extractHeadings(readmeContent);
  const templateHeadings = extractHeadings(templateContent);

  const errors = [];

  // Check for missing required sections (H2 headings from template)
  // Determine required and optional H2s from template
  const templateH2sRaw = templateHeadings.filter((h) => h.level === 2);
  const requiredH2s = [];
  const optionalH2s = [];
  for (const h of templateH2sRaw) {
    const isOptional = /\(optional\)\s*$/i.test(h.text);
    const label = h.text.replace(/\s*\(optional\)\s*$/i, "").trim();
    if (isOptional) optionalH2s.push(label);
    else requiredH2s.push(label);
  }

  const readmeH2s = readmeHeadings
    .filter((h) => h.level === 2)
    .map((h) => h.text);

  // Check for missing required sections only
  for (const requiredH2 of requiredH2s) {
    if (!readmeH2s.includes(requiredH2)) {
      errors.push(`Missing required section: ## ${requiredH2}`);
    }
  }

  // Check H1 heading exists
  const readmeH1s = readmeHeadings.filter((h) => h.level === 1);
  if (readmeH1s.length === 0) {
    errors.push("Missing H1 heading");
  } else if (readmeH1s.length > 1) {
    errors.push(`Multiple H1 headings found (${readmeH1s.length})`);
  }

  if (errors.length > 0) {
    console.error(`${RED}✗${RESET} ${filename}:`);
    errors.forEach((err) => console.error(`  ${RED}→${RESET} ${err}`));
    console.error(`  ${YELLOW}ℹ${RESET} Template: ${templatePath}`);
    hasErrors = true;
  } else {
    console.log(`${GREEN}✓${RESET} ${filename}`);
  }
}

/**
 * Main execution
 */
function main() {
  console.log(
    `${YELLOW}Validating README structure against templates...${RESET}\n`
  );

  for (const [readmePath, templatePath] of Object.entries(README_TEMPLATES)) {
    validateReadme(readmePath, templatePath);
  }

  if (hasErrors) {
    console.error(`\n${RED}README validation failed${RESET}`);
    console.error(
      `Fix the errors above or update templates if structure has changed intentionally.\n`
    );
    process.exit(1);
  } else {
    console.log(
      `\n${GREEN}✓ All README files validated successfully${RESET}\n`
    );
    process.exit(0);
  }
}

if (require.main === module) {
  main();
}
