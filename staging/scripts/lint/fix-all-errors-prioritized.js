#!/usr/bin/env node
/**
 * fix-all-errors-prioritized.js
 * Generalized orchestrator for all major documentation fix scripts.
 * Runs in prioritized order:
 * 1. Markdown style (lint:fix)
 * 2. Heading style (heading-style-fix.js)
 * 3. Naming conventions (naming-conventions-fix.js)
 * 4. ASCII diagrams (ascii-to-mermaid-fix.js)
 * 5. Cross-references (crossref-fix.js)
 * 6. Frontmatter (frontmatter-fix.js)
 * 7. General rules (fix-all-errors.js)
 *
 * Usage: node scripts/lint/fix-all-errors-prioritized.js
 */

const { execSync } = require("child_process");
const path = require("path");

// Parse CLI arguments for file/folder targeting
const args = process.argv.slice(2);
let targetArgs = "";
if (args.length > 0) {
  // Join all args as a space-separated string for shell commands
  targetArgs = args.map((a) => `"${a}"`).join(" ");
  console.log(`\nTargeting only: ${args.join(", ")}`);
}

function run(cmd, desc) {
  console.log(`\n=== ${desc} ===`);
  // If targetArgs is set, append to command if supported
  let fullCmd = cmd;
  if (targetArgs) {
    // Only append if the script supports file/folder args
    // For npm run docs:lint:fix, most scripts accept file/folder args
    if (cmd.startsWith("npm run docs:lint:fix")) {
      fullCmd = `${cmd} -- ${targetArgs}`;
    } else if (
      cmd.includes("heading-style-fix.js") ||
      cmd.includes("naming-conventions-fix.js") ||
      cmd.includes("crossref-fix.js") ||
      cmd.includes("frontmatter-fix.js") ||
      cmd.includes("fix-all-errors.js")
    ) {
      fullCmd = `${cmd} ${targetArgs}`;
    }
  }
  try {
    execSync(fullCmd, { stdio: "inherit" });
  } catch (e) {
    console.error(`Error running: ${fullCmd}`);
  }
}

// 1. Auto-fix markdown style issues
run(
  "npm run docs:lint:fix",
  "Auto-fix markdown style (MD012, MD047, MD007, MD005, MD032)"
);

// 2. Auto-fix heading style errors
run(
  "node scripts/lint/heading-style-fix.js",
  "Auto-fix heading style errors (MD003)"
);

// 3. Auto-fix naming convention violations
run(
  "node scripts/lint/naming-conventions-fix.js",
  "Auto-fix naming convention violations"
);

// 4. Scan and prompt for broken cross-references
run(
  "node scripts/lint/crossref-fix.js",
  "Scan for broken cross-references and prompt for manual fixing"
);

// 5. Scan and prompt for frontmatter issues
run(
  "node scripts/lint/frontmatter-fix.js",
  "Scan for missing or malformed frontmatter and prompt for manual correction"
);

// 6. Generalized auto-fix for all major rules
run(
  "node scripts/lint/fix-all-errors.js",
  "Generalized auto-fix for frontmatter, links, headings, HTML, attribution"
);

console.log(
  "\nAll prioritized auto-fixes attempted. Rerun validation to check remaining errors."
);
