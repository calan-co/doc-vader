#!/usr/bin/env node
/**
 * naming-conventions-fix.js
 * Auto-fix naming convention violations for documentation and template files.
 * Usage: node scripts/lint/naming-conventions-fix.js
 */
const fs = require("fs");
const path = require("path");
const glob = require("glob");

const renameMap = {
  // Example: 'docs/architecture/decisions/ADR-001-file-system-persistence.md': 'docs/architecture/decisions/adr-001-file-system-persistence.md',
  // Add more mappings as needed
};

console.log("Scanning for naming convention violations...");
Object.entries(renameMap).forEach(([oldPath, newPath]) => {
  if (fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, newPath);
    console.log(`Renamed: ${oldPath} -> ${newPath}`);
  }
});
console.log("Naming convention auto-fix complete.");
