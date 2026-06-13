#!/usr/bin/env node
/**
 * heading-style-fix.js
 * Auto-fix MD003 heading style errors by converting ATX headings to Setext style in markdown files.
 * Usage: node scripts/lint/heading-style-fix.js
 */
const fs = require("fs");
const glob = require("glob");

function convertATXtoSetext(content) {
  // Only convert H1 and H2 ATX headings
  return content
    .replace(
      /^(# )(.+)$\n/gm,
      (m, p1, p2) => `${p2}\n${"=".repeat(p1 === "# " ? p2.length : 0)}`
    )
    .replace(
      /^(## )(.+)$\n/gm,
      (m, p1, p2) => `${p2}\n${"-".repeat(p2.length)}`
    );
}

console.log("Scanning for ATX headings to convert to Setext...");
const files = glob.sync("docs/**/*.md");
files.forEach((file) => {
  let content = fs.readFileSync(file, "utf8");
  if (/^# .+$/m.test(content) || /^## .+$/m.test(content)) {
    const newContent = convertATXtoSetext(content);
    fs.writeFileSync(file, newContent, "utf8");
    console.log(`Converted headings in: ${file}`);
  }
});
console.log("Heading style auto-fix complete.");
