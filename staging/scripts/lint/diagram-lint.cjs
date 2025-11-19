#!/usr/bin/env node
// diagram-lint.js
// Validates that all diagrams in docs use Mermaid, not ASCII box-drawing
const fs = require("fs");
const path = require("path");
const { getMarkdownFilesFromArgs, reportErrors } = require("./lint-util.cjs");
const DOCS_DIR = path.resolve(__dirname, "../../../docs");
// Box-drawing characters often used in ASCII diagrams/trees
const BOX_CHARS_REGEX = /[┌┐└┘├┬─│]/;
const ARROW_CHAR = "→"; // unicode right arrow used in some ASCII-like flows

function isDirectoryTreeBlock(block) {
  const hasCornerChars = /[┌┐┘]/.test(block); // trees rarely use these
  const treeLines = block
    .split("\n")
    .filter((l) => /^\s*(├──|└──|│)/.test(l)).length;
  const hasSlashesOrExt = /\//.test(block) || /\.[a-z0-9]{1,4}\b/i.test(block);
  const firstNonEmpty = (block.match(/^(?!\s*$).+/m) || [""])[0];
  const firstLooksLikeRoot = /\/$/.test(firstNonEmpty);
  return (
    !hasCornerChars && treeLines >= 2 && (hasSlashesOrExt || firstLooksLikeRoot)
  );
}

function stripAllowedFences(markdown) {
  return markdown.replace(/```(\w+)?\n([\s\S]*?)```/g, (m, lang, body) => {
    const language = (lang || "").toLowerCase();
    if (language === "text" && isDirectoryTreeBlock(body)) {
      return "";
    }
    return m; // keep other fenced blocks for inspection
  });
}

function checkFile(file, relPath, errors) {
  const raw = fs.readFileSync(file, "utf8");
  const content = stripAllowedFences(raw);
  // Only flag if box-drawing chars or multi-line arrows are present
  const lines = content.split(/\r?\n/);
  let hasBoxChars = false;
  let arrowLines = 0;
  let offendingLine = -1;
  let offendingCol = -1;
  let offendingChar = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Ignore fenced code blocks already handled in stripAllowedFences
    // Ignore single arrows in list items
    if (/^\s*[-*] .*[→].*$/.test(line)) continue;
    // Detect box-drawing characters (strong signal of ASCII diagram)
    const match = line.match(BOX_CHARS_REGEX);
    if (match) {
      hasBoxChars = true;
      offendingLine = i + 1;
      offendingCol = line.indexOf(match[0]) + 1;
      offendingChar = match[0];
      break;
    }
  }

  if (!hasBoxChars) {
    // Assess arrow-heavy blocks as potential diagrams: count lines with >= 4 arrows
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const count = (line.match(new RegExp(ARROW_CHAR, "g")) || []).length;
      if (count >= 4) {
        arrowLines++;
        if (arrowLines === 1) {
          offendingLine = i + 1;
          offendingCol = line.indexOf(ARROW_CHAR) + 1;
          offendingChar = ARROW_CHAR;
        }
      }
      if (arrowLines >= 3) break; // threshold: at least 3 lines flagged for excessive arrows
    }
  }

  if (hasBoxChars || arrowLines >= 3) {
    let errorMsg = `ASCII diagram found in: ${relPath}`;
    if (offendingLine > 0 && offendingCol > 0) {
      errorMsg += ` (line ${offendingLine}, col ${offendingCol}, char '${offendingChar}')`;
      errorMsg += `\n  See: ${relPath}#L${offendingLine}:C${offendingCol}`;
    }
    errors.push(errorMsg);
  }
}

function main() {
  const args = process.argv.slice(2);
  const files = getMarkdownFilesFromArgs(args, [DOCS_DIR]);
  const errors = [];
  for (const file of files) {
    const relPath = path.relative(process.cwd(), file);
    checkFile(file, relPath, errors);
  }
  reportErrors(
    errors,
    "ASCII diagrams detected:",
    "All diagrams use Mermaid or are diagram-free."
  );
}
if (require.main === module) main();
