#!/usr/bin/env node

import { program } from "@commander-js/extra-typings";

// Import controller modules
import {
  analyzeDiataxis,
  fix,
} from "../lib/controllers/diataxisFrameworkController.js";
import {
  lint as lintFrontmatter,
  parse,
} from "../lib/controllers/frontmatterController.js";
import { lint as lintDoc } from "../lib/controllers/docController.js";
import { list as listBacklogItems } from "../lib/controllers/backlogController.js";

program
  .name("doc-vader")
  .description(
    "Doc-Vader CLI - documentation automation, validation, and utilities"
  )
  .version("1.0.0");

// --- DOMAIN: frontmatter ---
const frontmatter = program
  .command("frontmatter")
  .description("Frontmatter domain commands");

frontmatter
  .command("validate")
  .description("Validate frontmatter in documentation files")
  .argument("[path]", "Path to the docs directory")
  .option("--no-strict", "Disable strict mode (allow missing frontmatter)")
  .action(async (path, opts) => {
    const result = await lintFrontmatter({
      docsDir: path || "docs",
      strict: opts?.strict,
    });
    console.log(result);
  });

frontmatter
  .command("fix")
  .description("Auto-fix frontmatter in documentation files")
  .option("-d, --docs-dir <path>", "Path to the docs directory")
  .action((opts) => {
    // Placeholder for fix logic
    console.log("Frontmatter fix not yet implemented.");
  });

frontmatter
  .command("utils")
  .description("Frontmatter utilities (parse, format, etc)")
  .option("-i, --input <file>", "Input file")
  .action((opts) => {
    if (opts.input) {
      const parsed = parse(opts.input);
      console.log(parsed);
    } else {
      console.error("No input file provided.");
    }
  });

// --- DOMAIN: doc-system ---
const docSystem = program
  .command("doc-system")
  .description("Documentation system domain commands");

docSystem
  .command("diataxis-validate")
  .description("Validate documentation using Diataxis framework")
  .option("-f, --file <file>", "Input file")
  .option("-t, --diataxis <type>", "Diataxis type")
  .action((opts) => {
    if (!opts.file || !opts.diataxis) {
      console.error("Both --file and --diataxis are required.");
      return;
    }
    const result = analyzeDiataxis(opts.file, opts.diataxis);
    console.log(result);
  });

docSystem
  .command("diataxis-fix")
  .description("Auto-fix documentation to align with Diataxis framework")
  .argument("[path]", "Path to the docs directory")
  .option("--dry-run", "Show what would change without making changes")
  .action(async (path, opts) => {
    const result = await fix({ docsDir: path || "docs", dryRun: opts.dryRun });
    console.log(result);
  });

docSystem
  .command("validate")
  .description("Validate documentation files for structure and content")
  .option("-d, --docs-dir <path>", "Path to the docs directory")
  .option("--no-strict", "Disable strict mode (allow missing frontmatter)")
  .action(async (opts) => {
    const result = await lintDoc({
      docsDir: opts.docsDir || "docs",
      strict: opts.strict,
    });
    console.log(result);
  });

// --- DOMAIN: backlog ---
const backlog = program
  .command("backlog")
  .description("Backlog domain commands");

backlog
  .command("validate")
  .description("Validate backlog items")
  .action(() => {
    // Placeholder for backlog validation logic
    console.log("Backlog validate not yet implemented.");
  });

backlog
  .command("list")
  .description("List backlog items")
  .option("-d, --dir <path>", "Path to the backlog directory", "backlog")
  .option("-s, --subtype <subtype>", "Filter by work-item subtype")
  .action(async (opts) => {
    const items = await listBacklogItems(opts.dir, opts.subtype);
    console.log(items);
  });

// --- DOMAIN: governance ---
const governance = program
  .command("governance")
  .description("Governance profiles (documentation systems and process models)");

governance
  .command("list")
  .description("List available governance profiles")
  .option("--format <format>", "Output format: table|json", "table")
  .action((opts) => {
    // Placeholder: wire to governance controller when available
    const sample = [
      { name: "diataxis", category: "documentation" },
      { name: "tgdpr", category: "documentation" },
      { name: "sdlc", category: "process" },
    ];
    console.log(opts.format === "json" ? JSON.stringify(sample, null, 2) : sample);
  });

governance
  .command("detect")
  .description("Detect governance profiles for a file or folder")
  .argument("<path>", "File or directory to analyze")
  .option("--format <format>", "Output format: table|json", "table")
  .action((path, opts) => {
    // Placeholder: implement detection logic in controller
    console.log(
      `Governance detection is not yet implemented. Input: ${path}, format=${opts.format}`
    );
  });

governance
  .command("effective-rules")
  .description("Compute effective merged rules for a file")
  .argument("<file>", "Markdown file path")
  .option("--format <format>", "Output format: table|json", "table")
  .action((file, opts) => {
    // Placeholder: produce merged rules summary in chosen format
    console.log(
      `Effective rules is not yet implemented. Input: ${file}, format=${opts.format}`
    );
  });

governance
  .command("reconcile")
  .description("Reconcile conflicts between selected governance profiles")
  .argument("<file>", "Markdown file path")
  .option("--strategy <strategy>", "prompt|auto|split|prioritize", "prompt")
  .option("--dry-run", "Show plan without applying changes")
  .action((file, opts) => {
    // Placeholder: generate a reconciliation plan
    console.log(
      `Reconciliation is not yet implemented. file=${file}, strategy=${opts.strategy}, dryRun=${!!opts.dryRun}`
    );
  });

governance
  .command("migrate")
  .description("Migrate legacy 'frameworks' to 'governanceProfiles'")
  .option("--write", "Apply changes to files (default is dry-run)")
  .option("-d, --docs-dir <path>", "Path to the docs directory", "docs")
  .action((opts) => {
    // Placeholder: implement migration logic
    console.log(
      `Governance migration is not yet implemented. docsDir=${opts.docsDir}, write=${!!opts.write}`
    );
  });

// --- AGGREGATE ACTIONS ---
program
  .command("validate")
  .description("Validate all domains: frontmatter, doc-system, backlog")
  .action(async () => {
    console.log("Running frontmatter validation...");
    const fmResult = await lintFrontmatter({ docsDir: "docs" });
    console.log(fmResult);
    console.log("Running doc-system validation...");
    const docsResult = await lintDoc({ docsDir: "docs" });
    console.log(docsResult);
    console.log("Running backlog validation...");
    // Placeholder for backlog validation logic
    console.log("Backlog validate not yet implemented.");
  });

program.parse(process.argv);
