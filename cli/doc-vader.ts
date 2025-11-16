#!/usr/bin/env node

import { Command } from "commander";

//import { program } from "@commander-js/extra-typings";

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
import {
  listAvailable as governanceList,
  detect as governanceDetect,
  effectiveRules as governanceEffective,
  reconcile as governanceReconcile,
  migrate as governanceMigrate,
} from "../lib/controllers/governanceController.js";

const program = new Command()
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
  .action(async (path: string | undefined, opts: { strict?: boolean }) => {
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
  .action((opts: { docsDir?: string }) => {
    // Placeholder for fix logic
    console.log("Frontmatter fix not yet implemented.");
  });

frontmatter
  .command("utils")
  .description("Frontmatter utilities (parse, format, etc)")
  .option("-i, --input <file>", "Input file")
  .action((opts: { input?: string }) => {
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
  .action(async (path: string | undefined, opts: { dryRun?: boolean }) => {
    const result = await fix({ docsDir: path || "docs", dryRun: opts.dryRun });
    console.log(result);
  });

docSystem
  .command("validate")
  .description("Validate documentation files for structure and content")
  .option("-d, --docs-dir <path>", "Path to the docs directory")
  .option("-s, --schema-dir <path>", "Path to the schemas directory")
  .option("--no-strict", "Disable strict mode (allow missing frontmatter)")
  .action(
    async (opts: {
      docsDir?: string;
      schemaDir?: string;
      strict?: boolean;
    }) => {
      const result = await lintDoc({
        docsDir: opts.docsDir || "docs",
        schemaDir: opts.schemaDir || "schemas",
        strict: opts.strict,
      });
      console.log(result);
    }
  );

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
  .description(
    "Governance profiles (documentation systems and process models)"
  );

governance
  .command("list")
  .description("List available governance profiles")
  .option("--format <format>", "Output format: table|json", "table")
  .action(async (opts: { format: string }) => {
    const profiles = await governanceList();
    if (opts.format === "json") {
      console.log(JSON.stringify(profiles, null, 2));
    } else {
      console.table(profiles);
    }
  });

governance
  .command("detect")
  .description("Detect governance profiles for a file or directory")
  .argument("<path>", "File or directory to analyze")
  .option("--format <format>", "Output format: table|json", "table")
  .action(async (target: string, opts: { format: string }) => {
    const result = await governanceDetect(target);
    if (opts.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.table(
        result.flatMap((r) =>
          r.profiles.map((p) => ({
            file: r.file,
            name: p.name,
            mode: p.mode || "",
            version: p.version || "",
            category: p.category || "",
            form: p.sourceForm,
          }))
        )
      );
    }
  });

governance
  .command("effective-rules")
  .description("Show effective merged governance rules for a file")
  .argument("<file>", "Markdown file path")
  .option("--format <format>", "Output format: table|json", "table")
  .action(async (file: string, opts: { format: string }) => {
    const effective = await governanceEffective(file);
    const isProfiles = (obj: any): obj is { profiles: any[] } =>
      Array.isArray(obj?.profiles);
    if (opts.format === "json") {
      console.log(JSON.stringify(effective, null, 2));
    } else if (isProfiles(effective)) {
      console.table(
        effective.profiles.map((p: any) => ({
          name: p.name,
          mode: p.mode || "",
          version: p.version || "",
          category: p.category || "",
          form: p.sourceForm,
        }))
      );
    } else if ("message" in (effective as any)) {
      console.log((effective as any).message);
    }
  });

governance
  .command("reconcile")
  .description(
    "Reconcile conflicts between selected governance profiles (placeholder implementation)"
  )
  .argument("<file>", "Markdown file path")
  .option(
    "--strategy <strategy>",
    "prompt|auto|prioritize|intersection|override|split|advisory",
    "prompt"
  )
  .option("--dry-run", "Show plan without applying changes")
  .action(
    async (file: string, opts: { strategy: string; dryRun?: boolean }) => {
      const plan = await governanceReconcile(file, {
        strategy: opts.strategy,
        dryRun: opts.dryRun,
      });
      console.log(JSON.stringify(plan, null, 2));
    }
  );

governance
  .command("migrate")
  .description(
    "Migrate legacy governanceProfiles/reconciliation to new governance structure (placeholder)"
  )
  .option("--write", "Apply changes (default dry-run)")
  .option("-d, --docs-dir <path>", "Path to the docs directory", "docs")
  .action(async (opts: { docsDir: string; write?: boolean }) => {
    const result = await governanceMigrate(opts.docsDir, !!opts.write);
    console.log(JSON.stringify(result, null, 2));
  });

// --- AGGREGATE ACTIONS ---
program
  .command("validate")
  .description("Validate all domains: frontmatter, doc-system, backlog")
  .option("-d, --docs-dir <path>", "Path to the docs directory", "docs")
  .option("-s, --schema-dir <path>", "Path to the schemas directory", "schemas")
  .action(async (opts: { docsDir: string; schemaDir: string }) => {
    console.log("Running frontmatter validation...");
    const fmResult = await lintFrontmatter({ docsDir: opts.docsDir });
    console.log(JSON.stringify(fmResult, null, 2));
    console.log("Running doc-system validation...");
    const docsResult = await lintDoc({
      docsDir: opts.docsDir,
      schemaDir: opts.schemaDir,
    });
    console.log(JSON.stringify(docsResult, null, 2));
    console.log("Running backlog validation...");
    // Placeholder for backlog validation logic
    console.log("Backlog validate not yet implemented.");
  });

program.parse(process.argv);
