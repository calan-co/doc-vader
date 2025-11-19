#!/usr/bin/env node
// anchor-lint.js
// Detects explicit HTML anchor tags used as link targets in documentation
const fs = require("fs");
const path = require("path");

const DOCS_DIR = path.resolve(__dirname, "../../../docs");
const HTML_ANCHOR_REGEX = /<a\s+(?:id|name)=["'][^"']*["'][^>]*>/gi;

function checkFile(file, relPath, errors) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);

  let inCodeBlock = false;

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;

    // Track code block state
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      return;
    }

    // Skip lines in code blocks
    if (inCodeBlock) {
      return;
    }

    // Remove inline code (backticks) to avoid false positives in examples
    const lineWithoutInlineCode = line.replace(/`[^`]+`/g, "");

    const regex = /<a\s+(?:id|name)=["'][^"']*["'][^>]*>/gi;
    if (regex.test(lineWithoutInlineCode)) {
      errors.push(
        `Explicit HTML anchor in ${relPath}:${lineNum}\n  Use auto-generated heading anchors instead of <a id="..."> or <a name="...">`
      );
    }
  });
}

function walk(dir, rel, errors) {
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    const rp = path.join(rel, f);
    if (fs.statSync(fp).isDirectory()) {
      walk(fp, rp, errors);
    } else if (f.endsWith(".md")) {
      checkFile(fp, rp, errors);
    }
  }
}

function main() {
  const errors = [];
  walk(DOCS_DIR, "docs", errors);

  if (errors.length) {
    console.error("Explicit HTML anchors detected:");
    console.error("");
    for (const e of errors) {
      console.error(e);
      console.error("");
    }
    console.error(
      "Documentation standard: Use auto-generated heading anchors only."
    );
    console.error(
      "See docs/README.md 'Link and Anchor Standards' for details."
    );
    process.exit(1);
  } else {
    console.log("No explicit HTML anchors detected. ✓");
  }
}

if (require.main === module) main();
