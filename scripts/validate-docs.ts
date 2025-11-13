import { validateDocsWorkflow } from "../lib/docs/utils.js";
import path from "node:path";
import Ajv from "ajv";
import { Command } from "commander";

const ajv = new Ajv({ allErrors: true });

// CLI Entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const program = new Command();

  program
    .name("validate-docs")
    .description("Validate documentation frontmatter and Diataxis structure")
    .version("1.0.0")
    .option(
      "-d, --docs-dir <path>",
      "Path to the docs directory",
      process.env.LINKITY_DOCS_DIR || path.resolve(process.cwd(), "docs")
    )
    .option(
      "--no-strict",
      "Disable strict mode (allow missing frontmatter)",
      false
    )
    .action(async (options) => {
      try {
        const docsDir = path.resolve(options.docsDir);
        const schemaDir = path.join(docsDir, "schemas");

        // Determine strict mode: --no-strict flag overrides env var
        const envStrict = process.env.STRICT_FRONTMATTER;
        const strict =
          options.strict === false ? false : envStrict === "0" ? false : true;

        const {
          results,
          diataxisErrors,
          failures,
          warnings,
          missingWarnings,
          mdFiles,
        } = await validateDocsWorkflow({ docsDir, schemaDir, strict, ajv });

        if (mdFiles.length === 0) {
          console.log("No markdown files found under docs/.");
          return;
        }

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
        } else if (diataxisErrors.length) {
          console.error(
            `Diataxis folder validation failed for ${diataxisErrors.length} file(s):`
          );
          for (const d of diataxisErrors) {
            console.error(`\n## ${path.relative(process.cwd(), d.file)}`);
            console.error(` - ${d.error}`);
          }
          process.exit(1);
        } else {
          console.log(
            `Frontmatter validation passed for ${results.length} file(s).`
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
    });

  program.parse();
}
