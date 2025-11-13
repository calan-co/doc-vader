#!/usr/bin/env node
/**
 * validate-frontmatter.ts
 * Simplified: Validates Markdown frontmatter in /docs against JSON Schemas.
 * Uses helpers from frontmatter-utils.ts
 */
import path from "node:path";
import Ajv from "ajv";
import {
  readMarkdownFiles,
  ValidateResult,
  loadSchema as utilLoadSchema,
  getVersionedName as utilGetVersionedName,
} from "../lib/frontmatter/utils.js";
import { validateFrontmatter as utilValidateFrontmatter } from "../lib/frontmatter/lint.js";
import {
  FrontmatterLinter,
  FrontmatterFixer,
} from "../lib/frontmatter/lint.js";
import { FrontmatterClassifier } from "../lib/frontmatter/utils.js";
import { FrontmatterChecker } from "../lib/frontmatter/check.js";

const docsDir = process.env.LINKITY_DOCS_DIR
  ? path.resolve(process.env.LINKITY_DOCS_DIR)
  : path.resolve(process.cwd(), "docs");
const schemaDir = path.join(docsDir, "schemas");
const ajv = new Ajv({
  allErrors: true,
  loadSchema: async () => loadSchema,
  strictSchema: "log",
});

// CLI Entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  (async function main() {
    try {
      const argNoStrict = process.argv.includes("--no-strict");
      const envStrict = process.env.STRICT_FRONTMATTER;
      const strictMissing = argNoStrict
        ? false
        : envStrict === "0"
        ? false
        : true;
      const mdFiles = await readMarkdownFiles(docsDir);
      if (mdFiles.length === 0) {
        console.log("No markdown files found under docs/.");
        return;
      }
      const results = await Promise.all(
        mdFiles.map((f) => validateFrontmatter({ filePath: f, strictMissing }))
      );
      const failures = results.filter((r) => !r.ok && r.errors.length);
      const warnings = results.flatMap((r) => r.warnings || []);
      if (failures.length) {
        console.error(
          `Frontmatter validation failed for ${failures.length} file(s):`
        );
        for (const f of failures) {
          console.error(`\n## ${path.relative(process.cwd(), f.file)}`);
          for (const err of f.errors) {
            console.error(` - ${err}`);
          }
        }
        process.exit(1);
      } else {
        console.log(
          `Frontmatter validation passed for ${results.length} file(s).`
        );
        const missingWarnings = results.filter(
          (r) => (r.warnings || []).length
        );
        if (missingWarnings.length) {
          console.warn(`\nWarnings for ${missingWarnings.length} file(s):`);
          for (const f of missingWarnings) {
            console.warn(
              ` - ${path.relative(process.cwd(), f.file)}: ${f.warnings.join(
                "; "
              )}`
            );
          }
          console.warn(
            "\nTip: run with --strict or set STRICT_FRONTMATTER=1 to enforce frontmatter presence."
          );
        }
      }
    } catch (err) {
      console.error("Validator crashed:", err);
      process.exit(1);
    }
  })();
}

// Example usage of new interfaces/classes
const linter = new FrontmatterLinter();
const fixer = new FrontmatterFixer();
const classifier = new FrontmatterClassifier();
const checker = new FrontmatterChecker();

export function loadSchema(nameOrUri: string): Promise<any> {
  return utilLoadSchema(nameOrUri, schemaDir);
}

export function getVersionedName(name: string): Promise<string> {
  return utilGetVersionedName(name, schemaDir);
}

export function validateFrontmatter({
  filePath = "",
  content = "",
  strictMissing = true,
}: {
  filePath?: string;
  content?: string;
  strictMissing?: boolean;
}): Promise<ValidateResult> {
  return utilValidateFrontmatter({
    filePath,
    content,
    strictMissing,
    schemaDir,
    ajv,
  });
}
// You can now use linter.lint, fixer.fix, classifier.classify, checker.check as needed
