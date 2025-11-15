import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkLint from "remark-lint";
import remarkFrontmatterSchema from "remark-lint-frontmatter-schema";
import checklist from "../lib/plugins/remark-lint-checklist.ts";
import crossref from "../lib/plugins/remark-lint-crossref.ts";
import templateCompliance from "../lib/plugins/remark-lint-template-compliance.ts";
import fs from "fs";
import path from "path";
import { run as runUtil, createProcessor } from "../lib/plugins/tests/utils.ts";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: npx ts-node scripts/remark-lint.ts <file.md>");
  process.exit(1);
}
const markdown = fs.readFileSync(filePath, "utf8");

const processor = unified()
  .use(remarkParse)
  .use(remarkLint)
  .use(remarkFrontmatterSchema)
  .use(checklist, {
    requiredItems: [
      "Process improvement fully documented",
      "Success metrics defined",
      "Baseline metrics captured",
      "Metrics timeline defined and approved",
      "If applicable, process improvement mechanized",
      "All Acceptance Criteria Passing",
    ],
  })
  .use(crossref, { rootDir: path.dirname(filePath) })
  .use(templateCompliance, {
    requiredHeadings: ["Description", "Acceptance Criteria", "Checklist"],
  });

runUtil(markdown, processor)
  .then((file) => {
    if (file.messages.length) {
      file.messages.forEach((m) => {
        console.error(
          `${filePath}:${m.line || 1}:${m.column || 1} - ${m.message}`
        );
      });
      process.exit(2);
    } else {
      console.log("Lint passed.");
    }
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exit(3);
  });
