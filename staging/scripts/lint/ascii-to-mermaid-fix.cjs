#!/usr/bin/env node
/**
 * ascii-to-mermaid-fix.js
 * Scan for ASCII diagrams and prompt for manual conversion, with extraction of diagram blocks for easier conversion.
 * Usage: node scripts/lint/ascii-to-mermaid-fix.js
 */
const fs = require("fs");
const glob = require("glob");

console.log("Scanning for ASCII diagrams...");

const files = glob.sync("docs/**/*.md");
let batchPrompt = [];
const CODE_BLOCK_REGEX = /```(\w+)?\n([\s\S]*?)```/g;
const INLINE_CODE_REGEX = /`([^`]+)`/g;

files.forEach((file) => {
  const content = fs.readFileSync(file, "utf8");
  let diagrams = [];

  // Check multiline code blocks of type 'text'
  let match;
  while ((match = CODE_BLOCK_REGEX.exec(content))) {
    const lang = (match[1] || "").toLowerCase();
    const body = match[2];
    if (lang === "text" && /[+|\-]{3,}/.test(body)) {
      diagrams.push(body);
    }
  }

  // Check inline code blocks
  while ((match = INLINE_CODE_REGEX.exec(content))) {
    const code = match[1];
    if (/[+|\-]{3,}/.test(code)) {
      diagrams.push(code);
    }
  }

  if (diagrams.length > 0) {
    batchPrompt.push(`File: ${file}`);
    diagrams.forEach((diagram, idx) => {
      batchPrompt.push(`Diagram ${idx + 1}:`);
      batchPrompt.push(diagram);
      batchPrompt.push("---");
    });
  }
});

if (batchPrompt.length > 0) {
  console.log("\n=== BATCH CONVERSION PROMPT ===");
  console.log(
    "Convert the following ASCII diagrams to Mermaid syntax. For each diagram, provide the Mermaid code block and indicate the file and diagram number.\n"
  );
  console.log(batchPrompt.join("\n"));
  console.log("\n=== END OF PROMPT ===\n");
} else {
  console.log("No ASCII diagrams found.");
}
console.log("ASCII diagram scan complete.");
