#!/usr/bin/env node
/**
 * Unified remark-based documentation linting script
 * Replaces the collection of disparate linters (markdownlint-cli2, naming-conventions-lint, etc.)
 */

import { glob } from "glob";
import fs from "fs";
import path from "path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkLint from "remark-lint";
import remarkLintChecklist from "../lib/plugins/remark-lint-checklist.js";
import remarkLintCrossref from "../lib/plugins/remark-lint-crossref.js";
import remarkLintTemplateCompliance from "../lib/plugins/remark-lint-template-compliance.js";
import remarkLintNamingConventions from "../lib/plugins/remark-lint-naming-conventions.js";
import remarkLintNoAsciiDiagrams from "../lib/plugins/remark-lint-no-ascii-diagrams.js";
import remarkLintNoHtmlAnchors from "../lib/plugins/remark-lint-no-html-anchors.js";
import { VFile } from "vfile";

const args = process.argv.slice(2);
const patterns =
  args.length > 0 ? args : ["docs/**/*.md", "*.md", "backlog/**/*.md"];

// Create processor with all plugins
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkLint)
  .use(remarkLintChecklist, {})
  .use(remarkLintTemplateCompliance, {})
  .use(remarkLintNoAsciiDiagrams, {})
  .use(remarkLintNoHtmlAnchors, {})
  .use(remarkLintCrossref, { rootDir: process.cwd() })
  .use(remarkLintNamingConventions, {});

interface LintResult {
  file: string;
  messages: Array<{
    line: number;
    column: number;
    message: string;
    source: string;
  }>;
}

async function lintFiles(patterns: string[]): Promise<LintResult[]> {
  const results: LintResult[] = [];
  let processedCount = 0;

  for (const pattern of patterns) {
    const files = await glob(pattern, {
      ignore: ["node_modules/**", ".git/**", "dist/**", "coverage/**"],
    });

    for (const file of files) {
      try {
        const markdown = fs.readFileSync(file, "utf8");
        const tree = processor.parse(markdown);
        const vfile = new VFile({ value: markdown, path: file });

        await processor.run(tree, vfile);

        if (vfile.messages.length > 0) {
          results.push({
            file,
            messages: vfile.messages.map((msg: any) => ({
              line: msg.line || 1,
              column: msg.column || 1,
              message: msg.message,
              source: msg.source || "remark-lint",
            })),
          });
        }

        processedCount++;
      } catch (err) {
        console.error(`Error processing ${file}:`, err);
        process.exit(1);
      }
    }
  }

  return results;
}

// Main execution
lintFiles(patterns)
  .then((results) => {
    let hasErrors = false;

    if (results.length === 0) {
      console.log(
        `✓ All files passed validation (processed files with patterns: ${patterns.join(", ")})`,
      );
      process.exit(0);
    }

    // Print results in a format similar to linters
    for (const result of results) {
      for (const msg of result.messages) {
        console.error(
          `${result.file}:${msg.line}:${msg.column} - ${msg.source}: ${msg.message}`,
        );
        hasErrors = true;
      }
    }

    if (hasErrors) {
      console.error(`\n✗ Validation failed for ${results.length} file(s)`);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error("Fatal error during linting:", err);
    process.exit(2);
  });
