#!/usr/bin/env node
/**
 * convert-ascii-to-mermaid.js
 * Scan documentation for ASCII diagrams and prompt for manual conversion to Mermaid.
 * Usage: node scripts/lint/convert-ascii-to-mermaid.js
 */
const fs = require("fs");
const glob = require("glob");

console.log("Scanning for ASCII diagrams...");
const files = glob.sync("docs/**/*.md");
files.forEach((file) => {
  const content = fs.readFileSync(file, "utf8");
  if (/\+[-|]+\+/.test(content) || /\|[ -]+\|/.test(content)) {
    console.log(`ASCII diagram detected in: ${file}`);
    // Optionally, extract and print the diagram block for manual conversion
  }
});
console.log(
  "ASCII diagram scan complete. Please convert detected diagrams to Mermaid manually."
);
