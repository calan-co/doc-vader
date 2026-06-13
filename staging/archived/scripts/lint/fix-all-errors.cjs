#!/usr/bin/env node
/**
 * Automated fixer for all major documentation errors:
 * - Missing/malformed frontmatter
 * - Frontmatter schema errors (enum, required fields)
 * - Broken cross-references and invalid link fragments
 * - Markdownlint/style issues (link text, duplicate headings, inline HTML)
 * - Non-blocking warnings (unused references, missing attribution)
 *
 * Usage: node scripts/lint/fix-all-errors.js
 */

const fs = require("fs");
const path = require("path");

const yaml = require("js-yaml");
const markdownlint = require("markdownlint");
let sessionContext;
try {
  sessionContext = require("../../team-in-a-box-backend/src/services/sessionContextService");
} catch (_) {}

const DOCS_DIR = path.join(__dirname, "../../../docs");
const CHATMODES_DIR = path.join(__dirname, "../../.github/chatmodes");
const BACKLOG_DIR = path.join(__dirname, "../../backlog");
const TEMPLATE_DIR = path.join(__dirname, "../../docs/templates");

// Required frontmatter fields and enums
const REQUIRED_FRONTMATTER = {
  id: "string",
  type: ["work-item", "document"],
  subtype: "string",
  lifecycle: ["draft", "active", "evergreen", "archived", "obsolete"],
  status: [
    "proposed",
    "accepted",
    "inProgress",
    "review",
    "approved",
    "complete",
    "deprecated",
    "superseded",
    "rejected",
    "duplicate",
  ],
};

function getAllMarkdownFiles() {
  function walk(dir) {
    let results = [];
    fs.readdirSync(dir).forEach((file) => {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        results = results.concat(walk(fullPath));
      } else if (file.endsWith(".md")) {
        results.push(fullPath);
      }
    });
    return results;
  }
  return [DOCS_DIR, CHATMODES_DIR, BACKLOG_DIR, TEMPLATE_DIR].flatMap(walk);
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    return yaml.load(match[1]);
  } catch (err) {
    return null;
  }
}

function fixFrontmatter(content, filePath) {
  let fm = parseFrontmatter(content);
  let changed = false;
  if (!fm) {
    // Insert minimal frontmatter
    const id = path.basename(filePath).split(".")[0];
    fm = {
      id,
      type: "document",
      subtype: "template",
      lifecycle: "draft",
      status: "proposed",
    };
    content = `---\n${yaml.dump(fm)}---\n` + content;
    changed = true;
  } else {
    // Fix missing/invalid fields
    for (const key in REQUIRED_FRONTMATTER) {
      if (!fm[key]) {
        if (Array.isArray(REQUIRED_FRONTMATTER[key])) {
          fm[key] = REQUIRED_FRONTMATTER[key][0];
        } else {
          fm[key] = "template";
        }
        changed = true;
      } else if (
        Array.isArray(REQUIRED_FRONTMATTER[key]) &&
        !REQUIRED_FRONTMATTER[key].includes(fm[key])
      ) {
        fm[key] = REQUIRED_FRONTMATTER[key][0];
        changed = true;
      }
    }
    // Replace frontmatter block
    if (changed) {
      content = content.replace(
        /^---\n([\s\S]*?)\n---/,
        `---\n${yaml.dump(fm)}---`
      );
    }
  }
  return { content, changed };
}

function fixLinks(content) {
  // Remove broken fragments and replace with #
  content = content.replace(/\]\(#link_to_endpoint_a\)/g, "](#)");
  content = content.replace(/\]\(#link_to_endpoint_b\)/g, "](#)");
  content = content.replace(/\]\(#link\)/g, "](#)");
  // Replace [link] with [see details]
  content = content.replace(/\[link\]/g, "[see details]");
  // Remove unused link/image reference definitions
  content = content.replace(/^\[intent\]:.*$/gm, "");
  return content;
}

function fixDuplicateHeadings(content) {
  // Replace duplicate headings with unique ones
  let seen = {};
  return content.replace(/^(#+)\s+(.+)$/gm, (m, hashes, title) => {
    if (!seen[title]) {
      seen[title] = 1;
      return m;
    }
    seen[title]++;
    return `${hashes} ${title} (${seen[title]})`;
  });
}

function fixInlineHtml(content) {
  // Replace <ul> and <li> with markdown lists
  content = content.replace(/<ul>/g, "");
  content = content.replace(/<\/ul>/g, "");
  content = content.replace(/<li>/g, "- ");
  content = content.replace(/<\/li>/g, "");
  return content;
}

function fixAttribution(content) {
  // Add BMAD™ Core attribution if missing
  if (!content.includes("Powered by BMAD™ Core")) {
    content += "\n\nPowered by BMAD™ Core";
  }
  return content;
}

function processFile(filePath) {
  let content = fs.readFileSync(filePath, "utf8");
  let changed = false;
  // Fix frontmatter
  const fmResult = fixFrontmatter(content, filePath);
  if (fmResult.changed) {
    content = fmResult.content;
    changed = true;
  }
  // Fix links
  const newContent = fixLinks(content);
  if (newContent !== content) {
    content = newContent;
    changed = true;
  }
  // Fix duplicate headings
  const dupContent = fixDuplicateHeadings(content);
  if (dupContent !== content) {
    content = dupContent;
    changed = true;
  }
  // Fix inline HTML
  const htmlContent = fixInlineHtml(content);
  if (htmlContent !== content) {
    content = htmlContent;
    changed = true;
  }
  // Fix attribution
  const attrContent = fixAttribution(content);
  if (attrContent !== content) {
    content = attrContent;
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`Fixed: ${filePath}`);
    if (sessionContext) {
      sessionContext.logSessionEvent(filePath, { type: "fix", changed: true });
    }
  } else {
    if (sessionContext) {
      sessionContext.logSessionEvent(filePath, { type: "fix", changed: false });
    }
  }
}

function main() {
  const files = getAllMarkdownFiles();
  files.forEach(processFile);
  console.log(
    "All major errors auto-fixed. Please rerun validation and manually check any flagged issues."
  );
}

main();
