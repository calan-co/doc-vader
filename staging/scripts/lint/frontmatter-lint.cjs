#!/usr/bin/env node
/**
 * @precommitRule Validates markdown frontmatter against the correct schema for docs and backlog.
 * @note Canonical required fields/types/enums are now enforced by JSON schemas (see schemas/).
 * @note This script only runs schema validation and does not duplicate any field/type logic.
 */

// frontmatter-lint.js
// Validates markdown frontmatter against the correct schema for docs and backlog
// Usage:
//   node frontmatter-lint.js                # Validate all docs and backlog
//   node frontmatter-lint.js file1.md ...    # Validate specific files
//   node frontmatter-lint.js dir1 dir2 ...   # Validate all .md files in specified dirs

const { Command } = require("commander");
const fs = require("fs");
const glob = require("glob");
const path = require("path");
const selectSchema = require("../utils/selectSchema.cjs");
const {
  extractFrontmatter,
  validateFrontmatter,
} = require("../utils/frontmatter.cjs");
let sessionContext;
try {
  sessionContext = require("../../team-in-a-box-backend/src/services/sessionContextService.js");
} catch (_) {}

function getMarkdownFilesFromDirs(dirs) {
  const files = [];
  for (const dir of dirs) {
    walk(dir, files);
  }
  return files;
}
function walk(dir, files) {
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    if (fs.statSync(fp).isDirectory()) walk(fp, files);
    else if (f.endsWith(".md")) files.push(fp);
  }
}

const program = new Command();
program
  .name("frontmatter-lint")
  .description("Validate markdown frontmatter against schemas")
  .argument(
    "[files...]",
    "Markdown files, directories, or glob patterns to validate"
  )
  .option("-v, --verbose", "Enable verbose output")
  .action(async (files, options) => {
    let fileList = [];
    if (!files || files.length === 0) {
      // Default: validate all docs and backlog
      files = ["docs/**/*.md", "backlog/**/*.md"];
    }
    for (const arg of files) {
      if (arg.includes("*")) {
        fileList.push(...glob.sync(arg));
      } else {
        const p = path.resolve(process.cwd(), arg);
        if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
          fileList.push(...getMarkdownFilesFromDirs([p]));
        } else if (fs.existsSync(p) && p.endsWith(".md")) {
          fileList.push(p);
        }
      }
    }
    if (fileList.length === 0) {
      console.error("No markdown files found for frontmatter validation.\n");
      process.exit(1);
    }
    let hasErrors = false;
    let errorFiles = [];
    let totalErrors = 0;
    for (const file of fileList) {
      const frontmatter = extractFrontmatter(file);
      let valid = true;
      let errors = [];
      if (!frontmatter) {
        console.error(`Missing or malformed frontmatter: ${file}\n`);
        valid = false;
        errors = ["Missing or malformed frontmatter"];
        hasErrors = true;
        errorFiles.push({ file, errors });
        totalErrors++;
      } else {
        const schemaPath = selectSchema(file, frontmatter);
        if (!schemaPath) {
          if (options.verbose) console.warn(`No schema found for: ${file}\n`);
        } else {
          errors = await validateFrontmatter(frontmatter, schemaPath);
          if (errors.length) {
            // Aggregate and normalize errors
            const agg = {
              required: [],
              additional: [],
              enum: 0,
              then: 0,
              other: [],
            };
            for (const err of errors) {
              let match = err.match(
                /must have required property '(?<field>[^']+)'/
              );
              if (match) {
                agg.required.push(match.groups.field);
                continue;
              }
              match = Array.from(
                err.matchAll(
                  /is missing the required field '(?<field>[^']+)'\./g
                )
              );
              if (match.length > 0) {
                for (const m of match) {
                  agg.required.push(m.groups.field);
                }
                continue;
              }
              match = err.match(
                /has an unexpected property, (?<field>[^,]+?), which is not in the list of allowed properties/
              );
              if (match) {
                agg.additional.push(match.groups.field);
                continue;
              }
              if (err.match(/must be equal to one of the allowed values/)) {
                agg.enum++;
                continue;
              }
              if (err.match(/must match "then" schema/)) {
                agg.then++;
                continue;
              }
              agg.other.push(err);
            }
            // Print aggregated errors
            console.error(`\nFrontmatter errors in ${file}:`);
            if (agg.required.length) {
              console.error(
                `  Missing required fields: ${agg.required.join(", ")}`
              );
              totalErrors += agg.required.length;
            }
            if (agg.additional.length) {
              console.error(
                `  Contains additional properties not allowed: ${agg.additional.join(
                  ", "
                )}`
              );
              totalErrors += agg.additional.length;
            }
            if (agg.enum) {
              console.error(
                `  Invalid value for enum field. (${agg.enum} occurrence${
                  agg.enum > 1 ? "s" : ""
                })`
              );
              totalErrors += agg.enum;
            }
            // if (agg.then) {
            //   console.error(
            //     `  Failed conditional schema validation. (${
            //       agg.then
            //     } occurrence${agg.then > 1 ? "s" : ""})\n`
            //   );
            //   totalErrors += agg.then;
            // }
            if (agg.other.length) {
              for (const msg of agg.other) {
                console.error(`  ${msg}`);
                totalErrors++;
              }
            }
            valid = false;
            hasErrors = true;
            errorFiles.push({ file, errors });
          }
        }
      }
      if (sessionContext) {
        sessionContext.recordValidation(file, valid, errors, { valid, errors });
      }
    }
    if (hasErrors) {
      // Print summary
      console.error(
        `\nValidation failed: ${errorFiles.length} of ${fileList.length} files have errors.`
      );
      console.error(`Total errors found: ${totalErrors}\n`);
      process.exit(1);
    } else {
      console.log("✓ All markdown frontmatter valid against schemas\n");
    }
  });

program.parseAsync(process.argv);
