// Story content structure linter for *.story.md files
import fs from "fs";
import path from "path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORIES_DIR = path.join(__dirname, "..", "..", "docs", "stories");

const mandatoryH3 = [
  "Previous Story Insights",
  "Data Models",
  "API Specifications",
];
const optionalH3 = [
  "Component Specifications",
  "File Locations",
  "Testing Requirements",
  "QA Results",
  "Tasks / Subtasks",
  "Completion Criteria",
  "Review Date",
  "Reviewed By",
];

function validateStoryStructure(file) {
  const content = fs.readFileSync(file, "utf8");
  const tree = unified().use(remarkParse).parse(content);

  const headers = [];
  visit(tree, "heading", (node) => {
    const text = node.children.map((c) => c.value || "").join("");
    headers.push({ depth: node.depth, text });
  });

    // Required sections in order (all H2 to comply with MD025 - frontmatter title is H1)
    // Note: Title, Status, Story Statement, and Acceptance Criteria are now in frontmatter
    const requiredSections = [
      { text: /^Story \d+\.\d+: /, required: true },
      { text: "Dev Notes", required: true },
    ];

    // Optional sections that may appear
    const optionalSections = ["Related Artifacts", "QA Results", "Tasks / Subtasks"];

  let errors = [];

  // Filter to only H2 headers
  const h2Headers = headers.filter((h) => h.depth === 2);

  // Check required sections exist and are in order
  let lastRequiredIdx = -1;
  requiredSections.forEach((req) => {
    const idx = h2Headers.findIndex((h) =>
      req.text instanceof RegExp ? req.text.test(h.text) : h.text === req.text
    );

    if (idx === -1) {
      errors.push(`Missing required section: '${req.text}'`);
    } else if (idx < lastRequiredIdx) {
      errors.push(`Section '${req.text}' is out of order`);
    } else {
      lastRequiredIdx = idx;
    }
  });

  // Find Dev Notes H3 subsections
  const devNotesIdx = headers.findIndex(
    (h) => h.text === "Dev Notes" && h.depth === 2
  );
  let h3s = [];
  if (devNotesIdx !== -1) {
    for (
      let i = devNotesIdx + 1;
      i < headers.length && headers[i].depth >= 3;
      i++
    ) {
      if (headers[i].depth === 3) h3s.push(headers[i].text);
      if (headers[i].depth < 3) break;
    }
  }

  // Check mandatory H3 subsections
  mandatoryH3.forEach((sub) => {
    if (!h3s.includes(sub)) {
      errors.push(`Missing mandatory subsection: '${sub}' under Dev Notes`);
    }
  });

  // Check for duplicate H3s
  const seen = new Set();
  h3s.forEach((h) => {
    if (seen.has(h))
      errors.push(`Duplicate subsection: '${h}' under Dev Notes`);
    seen.add(h);
  });

  // Check for out-of-order mandatory H3s
  let lastIdx = -1;
  mandatoryH3.forEach((sub) => {
    const idx = h3s.indexOf(sub);
    if (idx !== -1 && idx < lastIdx) {
      errors.push(`Subsection '${sub}' is out of order under Dev Notes`);
    }
    if (idx !== -1) lastIdx = idx;
  });

  return errors;
}

// Main
fs.readdirSync(STORIES_DIR)
  .filter((f) => f.endsWith(".story.md"))
  .forEach((f) => {
    const file = path.join(STORIES_DIR, f);
    const errors = validateStoryStructure(file);
    if (errors.length) {
      console.error(`\x1b[31m✗ ${f}:\x1b[0m`);
      errors.forEach((e) => console.error(`  \x1b[31m→ ${e}\x1b[0m`));
    } else {
      console.log(`\x1b[32m✓ ${f}\x1b[0m`);
    }
  });
