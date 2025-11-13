#!/usr/bin/env node
/**
 * frontmatter-fix.js
 * Auto-fix missing or malformed frontmatter in documentation files by reporting and suggesting manual fixes.
 * Usage: node scripts/lint/frontmatter-fix.js
 */
const fs = require("fs");
const glob = require("glob");

console.log("Scanning for frontmatter issues...");
const files = glob.sync("docs/**/*.md");
files.forEach((file) => {
  const content = fs.readFileSync(file, "utf8");
  if (!/^---\n[\s\S]*?---\n/.test(content)) {
    console.log(`Missing or malformed frontmatter in: ${file}`);
  }
});
console.log("Frontmatter scan complete. Please fix reported issues manually.");
