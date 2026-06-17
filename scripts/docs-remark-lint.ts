#!/usr/bin/env node
/// <reference types="node" />
/**
 * Unified remark-based documentation linting script
 * Replaces the collection of disparate linters (markdownlint-cli2, naming-conventions-lint, etc.)
 */

import { glob } from "glob";
import { readFileSync } from "node:fs";
import process from "node:process";
import {
  createTiabProcessor,
  type TiabProcessorOptions,
} from "../lib/processor.js";
import { VFile } from "vfile";

type OutputFormat = "text" | "json";
type FailOn = "error" | "warning";

const rawArgs = process.argv.slice(2);
let format: OutputFormat = "text";
let failOn: FailOn = "error";
const patterns: string[] = [];

for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  if (arg === "--format") {
    const value = rawArgs[i + 1];
    if (!value || (value !== "text" && value !== "json")) {
      console.error("--format must be one of: text, json");
      process.exit(2);
    }
    format = value;
    i++;
    continue;
  }
  if (arg.startsWith("--format=")) {
    const value = arg.slice("--format=".length);
    if (value !== "text" && value !== "json") {
      console.error("--format must be one of: text, json");
      process.exit(2);
    }
    format = value;
    continue;
  }
  if (arg === "--fail-on") {
    const value = rawArgs[i + 1];
    if (!value || (value !== "error" && value !== "warning")) {
      console.error("--fail-on must be one of: error, warning");
      process.exit(2);
    }
    failOn = value;
    i++;
    continue;
  }
  if (arg.startsWith("--fail-on=")) {
    const value = arg.slice("--fail-on=".length);
    if (value !== "error" && value !== "warning") {
      console.error("--fail-on must be one of: error, warning");
      process.exit(2);
    }
    failOn = value;
    continue;
  }

  patterns.push(arg);
}

const effectivePatterns =
  patterns.length > 0 ? patterns : ["docs/**/*.md", "*.md", "backlog/**/*.md"];
const schemaDir = process.env.DOCS_SCHEMA_DIR?.trim() || "schemas/frontmatter";
const processorOptions: TiabProcessorOptions = {
  crossref: { rootDir: process.cwd() },
  diataxisClassifier: { enabled: true },
  namingConventions: { enabled: true },
  noAsciiDiagrams: { enabled: false },
  noHtmlAnchors: { enabled: true },
  templateCompliance: { enabled: false, requiredHeadings: ["__disabled__"] },
  workItemArchiveReadiness: { enabled: true },
  workItemClosureEvidence: { enabled: true },
  frontmatterSchema: { enabled: true, schemaDir, severity: "error" },
};

const processor = createTiabProcessor(processorOptions);

interface LintResult {
  file: string;
  messages: Array<{
    line: number;
    column: number;
    message: string;
    source: string;
    severity: "error" | "warning";
  }>;
}

async function lintFiles(patternsToLint: string[]): Promise<LintResult[]> {
  const results: LintResult[] = [];

  for (const pattern of patternsToLint) {
    const files = await glob(pattern, {
      ignore: ["node_modules/**", ".git/**", "dist/**", "coverage/**"],
    });

    for (const file of files) {
      try {
        const markdown = readFileSync(file, "utf8");
        const tree = processor.parse(markdown);
        const vfile = new VFile({ value: markdown, path: file });

        await processor.run(tree, vfile);

        if (vfile.messages.length > 0) {
          results.push({
            file,
            messages: vfile.messages.map((msg: any) => ({
              line: msg.line || 1,
              column: msg.column || 1,
              position: msg.place || null,
              message: msg.message,
              source: msg.source || "remark-lint",
              severity: msg.fatal === true ? "error" : "warning",
            })),
          });
        }
      } catch (err) {
        console.error(`Error processing ${file}:`, err);
        process.exit(1);
      }
    }
  }

  return results;
}

// Main execution
lintFiles(effectivePatterns)
  .then((results) => {
    const allMessages = results.flatMap((result) => result.messages);
    const warningCount = allMessages.filter(
      (msg) => msg.severity === "warning",
    ).length;
    const errorCount = allMessages.filter(
      (msg) => msg.severity === "error",
    ).length;
    const shouldFail =
      failOn === "warning" ? warningCount + errorCount > 0 : errorCount > 0;

    if (format === "json") {
      const payload = {
        format,
        failOn,
        passed: !shouldFail,
        summary: {
          filesWithMessages: results.length,
          errorCount,
          warningCount,
        },
        patterns: effectivePatterns,
        results,
      };
      console.log(JSON.stringify(payload, null, 2));
      process.exit(shouldFail ? 1 : 0);
    }

    if (results.length === 0) {
      console.log(
        `✓ All files passed validation (processed files with patterns: ${effectivePatterns.join(
          ", ",
        )})`,
      );
      process.exit(0);
    }

    for (const result of results) {
      for (const msg of result.messages) {
        console.error(
          `${result.file}:${msg.line}:${msg.column} - ${msg.source} (${msg.severity}): ${msg.message}`,
        );
      }
    }

    if (shouldFail) {
      console.error(`\n✗ Validation failed for ${results.length} file(s)`);
      process.exit(1);
    }

    console.log(`\n✓ Validation passed with ${warningCount} warning(s)`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Fatal error during linting:", err);
    process.exit(2);
  });
