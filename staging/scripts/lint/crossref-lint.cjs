#!/usr/bin/env node
// crossref-lint.js
// Validate that all markdown links point to existing files and, if present, valid anchors
const fs = require("fs");
const path = require("path");
const { getMarkdownFilesFromArgs, reportErrors } = require("./lint-util.cjs");
const DOCS_DIR = path.resolve(__dirname, "../../../docs");
const LINK_REGEX = /\]\(([^)]+)\)/g; // captures the URL part inside (...)

function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\//g, "") // remove slashes per VS Code/GitHub style
    .replace(/\s+/g, "-") // spaces to '-'
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\-]/g, "") // drop punctuation (keep hyphen only)
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractHeadingSlugs(markdown) {
  const slugs = new Set();
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.+)$/.exec(line);
    if (m) {
      const headingText = m[2].trim();
      slugs.add(slugify(headingText));
    }
  }
  return slugs;
}

function resolveAndCheck(filePath, relPath, link, errors) {
  // ignore external links and mailto
  if (/^(https?:)?\/\//i.test(link) || link.startsWith("mailto:")) return;

  // split fragment
  let base = link;
  let fragment = null;
  const hashIndex = link.indexOf("#");
  if (hashIndex !== -1) {
    base = link.substring(0, hashIndex) || "";
    fragment = link.substring(hashIndex + 1);
  }

  // determine target file
  let targetFile = base ? path.resolve(path.dirname(filePath), base) : filePath; // in-page anchor

  // ensure .md file path exists (support links to folder/README.md)
  if (!fs.existsSync(targetFile)) {
    // If base links to a directory, try README.md inside it
    try {
      const stat = fs.statSync(targetFile);
      if (stat.isDirectory()) {
        const readme = path.join(targetFile, "README.md");
        if (fs.existsSync(readme)) targetFile = readme;
      }
    } catch (_) {
      // If missing extension, try appending .md
      if (path.extname(targetFile) === "") {
        const withMd = targetFile + ".md";
        if (fs.existsSync(withMd)) targetFile = withMd;
      }
    }
  }

  if (!fs.existsSync(targetFile)) {
    errors.push(`Broken link in ${relPath}: ${link}`);
    return;
  }

  // if there is a fragment, validate against heading slugs
  if (fragment) {
    const content = fs.readFileSync(targetFile, "utf8");
    const headings = extractHeadingSlugs(content);
    const fragSlug = slugify(fragment);
    if (!headings.has(fragSlug)) {
      errors.push(`Broken link in ${relPath}: ${link}`);
    }
  }
}

function checkFile(file, relPath, errors) {
  const content = fs.readFileSync(file, "utf8");

  let match;
  LINK_REGEX.lastIndex = 0; // reset regex state
  while ((match = LINK_REGEX.exec(content))) {
    const link = match[1];
    const matchIndex = match.index;

    // Skip links that are inside inline code (backticks)
    // Count backticks before this match to see if we're inside code
    const beforeMatch = content.substring(0, matchIndex);
    const backtickCount = (beforeMatch.match(/`/g) || []).length;
    // If odd number of backticks, we're inside inline code
    if (backtickCount % 2 === 1) {
      continue;
    }

    resolveAndCheck(file, relPath, link, errors);
  }
}

function main() {
  const args = process.argv.slice(2);
  const files = getMarkdownFilesFromArgs(args, [DOCS_DIR]);
  const errors = [];
  if (files.length === 0) {
    console.log(
      "No markdown files found for validation. Pass files or directories as arguments."
    );
    process.exit(0);
  }
  // Only check cross-references in the files explicitly passed as arguments
  let filesToCheck = files;
  if (args.length > 0) {
    // Only check files that were explicitly passed as arguments
    filesToCheck = args
      .map((arg) => path.resolve(process.cwd(), arg))
      .filter((f) => files.includes(f));
  }
  // Only report errors for files in filesToCheck
  const filteredErrors = [];
  for (const file of filesToCheck) {
    const relPath = path.relative(process.cwd(), file);
    const beforeLen = errors.length;
    checkFile(file, relPath, errors);
    // Only keep errors for this file
    for (let i = beforeLen; i < errors.length; ++i) {
      if (errors[i].includes(relPath)) {
        filteredErrors.push(errors[i]);
      }
    }
  }
  const scopeMsg =
    args.length > 0 ? ` (scope: ${filesToCheck.length} file(s))` : "";
  reportErrors(
    filteredErrors,
    `Broken cross-references${scopeMsg}:`,
    `All cross-references${scopeMsg} are valid.`
  );
}
if (require.main === module) main();
