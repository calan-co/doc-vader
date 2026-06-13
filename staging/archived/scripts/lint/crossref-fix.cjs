#!/usr/bin/env node
/**
 * crossref-fix.js
 * Auto-fix broken cross-references in documentation by reporting and suggesting manual fixes.
 * Usage: node scripts/lint/crossref-fix.js
 */

const fs = require("fs");
const glob = require("glob");
const path = require("path");

function findCandidates(link) {
  // Remove leading './' or '/'
  let base = link.replace(/^\.\//, "").replace(/^\//, "");
  // Remove anchor/hash
  base = base.split("#")[0];
  // Remove extension for matching
  const baseNoExt = base.replace(/\.[a-zA-Z0-9]+$/, "");
  // Find all markdown files in docs/
  const allFiles = glob.sync("docs/**/*.md");
  // Find exact matches (filename or filename without extension)
  const exact = allFiles.filter((f) => {
    const fname = path.basename(f);
    const fnameNoExt = fname.replace(/\.[a-zA-Z0-9]+$/, "");
    return fname === base || fnameNoExt === baseNoExt;
  });
  // Find close matches (substring)
  const close = allFiles.filter((f) => {
    const fname = path.basename(f);
    return fname.includes(baseNoExt);
  });
  return { exact, close };
}

function updateLinksInFile(file, brokenLinks) {
  let content = fs.readFileSync(file, "utf8");
  let updated = false;
  brokenLinks.forEach(([, text, link]) => {
    const { exact, close } = findCandidates(link);
    if (exact.length === 1) {
      // Auto-fix: convert to wikilink [[filename]]
      const wikilink = `[[${path.basename(exact[0])}]]`;
      const old = `[${text}](${link})`;
      content = content.replace(old, wikilink);
      updated = true;
      console.log(`Auto-fixed: ${old} → ${wikilink} in ${file}`);
    } else if (exact.length > 1) {
      console.log(`Multiple exact matches for [${text}](${link}) in ${file}:`);
      exact.forEach((f) => console.log(`  - ${f}`));
      console.log("Please select the correct file and update manually.");
    } else if (close.length > 0) {
      console.log(`Close matches for [${text}](${link}) in ${file}:`);
      close.forEach((f) => console.log(`  - ${f}`));
      console.log("Please select the correct file and update manually.");
    } else {
      console.log(`No candidates found for [${text}](${link}) in ${file}.`);
    }
  });
  if (updated) {
    fs.writeFileSync(file, content, "utf8");
  }
}

console.log("Scanning for broken cross-references...");
const files = glob.sync("docs/**/*.md");
files.forEach((file) => {
  const content = fs.readFileSync(file, "utf8");
  const brokenLinks = [...content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].filter(
    ([, , link]) => {
      return (
        link.includes("guide_") ||
        link.includes("process_") ||
        link.includes("resources_")
      );
    }
  );
  if (brokenLinks.length) {
    updateLinksInFile(file, brokenLinks);
  }
});
console.log(
  "Cross-reference scan complete. Auto-fixes applied where possible. Please review any manual prompts above."
);
