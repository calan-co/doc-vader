#!/usr/bin/env node
// folder-structure-lint.js
// Enforces documentation folder structure per README template
const fs = require("fs");
const path = require("path");
const DOCS_DIR = path.resolve(__dirname, "../../../docs");
const REQUIRED = [
  "project-brief.md",
  "architecture",
  "discovery",
  "guide",
  "prd",
  "process",
  "qa",
  "stories",
];
function main() {
  const missing = [];
  for (const item of REQUIRED) {
    const fp = path.join(DOCS_DIR, item);
    if (!fs.existsSync(fp)) missing.push(item);
  }
  if (missing.length) {
    console.error("Missing required docs structure:");
    for (const m of missing) console.error("  " + m);
    process.exit(1);
  } else {
    console.log("Documentation folder structure is valid.");
  }
}
if (require.main === module) main();
