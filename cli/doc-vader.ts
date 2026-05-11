#!/usr/bin/env node

import { Command, Option } from "commander";

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
import type { SubjectResolverName } from "../lib/backlog/scan-types.js";
import { DEFAULT_RESOLVER_ORDER } from "../lib/backlog/scan-resolver.js";
import {
  list as listBacklogItems,
  validate as validateBacklog,
  formatAuditReportText,
  scanBacklog,
  formatScanReport,
} from "../lib/controllers/backlogController.js";
import {
  listAvailable as governanceList,
  detect as governanceDetect,
  effectiveRules as governanceEffective,
  reconcile as governanceReconcile,
  migrate as governanceMigrate,
} from "../lib/controllers/governanceController.js";
import {
  transition as transitionWorkItem,
  link as linkWorkItem,
  recordCommit as recordWorkItemCommit,
  createRecord as createWorkRecord,
  finalize as finalizeWorkItem,
  migrate as migrateBacklogWorkManagement,
  ingestEvent as ingestBacklogEvent,
} from "../lib/controllers/workManagementController.js";

const program = new Command()
  .name("doc-vader")
  .description(
    "Doc-Vader CLI - documentation automation, validation, and utilities",
  )
  .version("1.0.0");

const collectOption = (value: string, previous: string[] = []) => [
  ...previous,
  value,
];

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
    },
  );

// --- DOMAIN: backlog ---
const backlog = program
  .command("backlog")
  .description("Backlog domain commands");

backlog
  .command("validate")
  .description("Validate backlog items")
  .option("-d, --dir <path>", "Path to the backlog directory", "backlog")
  .option("--format <format>", "Output format: text|json")
  .option("--fail-on <level>", "Fail level for exit code: error|warning")
  .option(
    "--profile <nameOrPath>",
    "Validation profile name (default|strict|ci) or JSON profile path",
  )
  .option(
    "--schema-map <path>",
    "Optional schema-map JSON path for schema routing",
  )
  .option(
    "--include-archive",
    "Include backlog/archive files in audit validation",
    false,
  )
  .action(async (opts) => {
    const report = await validateBacklog({
      backlogDir: opts.dir,
      format: opts.format,
      failOn: opts.failOn,
      profile: opts.profile,
      schemaMap: opts.schemaMap,
      includeArchive: opts.includeArchive,
    });

    const outputFormat = opts.format || report.options.format;
    if (outputFormat === "json") {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatAuditReportText(report));
    }

    if (report.exit_code !== 0) {
      process.exit(report.exit_code);
    }
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

backlog
  .command("migrate")
  .description(
    "Migrate a legacy backlog to canonical doc-vader work-management artifacts",
  )
  .option("-d, --dir <path>", "Path to the legacy backlog directory")
  .option("--consumer-config <path>", "Path to consumer config JSON")
  .option("--dry-run", "Show what would change without writing files")
  .option("--write", "Apply the migration")
  .action(async (opts) => {
    if (opts.write && opts.dryRun) {
      throw new Error("Use either --write or --dry-run, not both.");
    }
    const result = await migrateBacklogWorkManagement({
      dir: opts.dir,
      consumerConfig: opts.consumerConfig,
      dryRun: opts.write ? false : Boolean(opts.dryRun ?? true),
    });
    console.log(JSON.stringify(result, null, 2));
  });

backlog
  .command("ingest-event")
  .description("Ingest a forge/VCS event payload and apply backlog mutations")
  .requiredOption(
    "--provider <provider>",
    "Provider: github|gitlab|bitbucket|subversion",
  )
  .requiredOption("--event <event>", "Event name, e.g. pull_request.closed")
  .requiredOption("--payload <path>", "Path to JSON payload file")
  .option("--consumer-config <path>", "Path to consumer config JSON")
  .option("--dry-run", "Show the mutations without writing files")
  .action(async (opts) => {
    const result = await ingestBacklogEvent({
      provider: opts.provider,
      event: opts.event,
      payloadPath: opts.payload,
      consumerConfig: opts.consumerConfig,
      dryRun: opts.dryRun,
    });
    console.log(JSON.stringify(result, null, 2));
  });

backlog
  .command("scan")
  .description("Scan backlog files and report structural integrity findings")
  .option("-d, --dir <path>", "Path to the backlog directory", "backlog")
  .addOption(
    new Option("--report-format <format>", "Output format: text|json")
      .choices(["text", "json"])
      .default("text"),
  )
  .option("--output-file <path>", "Write report to file instead of stdout")
  .option(
    "--consumer-config <path>",
    "Path to consumer config JSON",
    ".doc-vader/backlog-consumer.json",
  )
  .option(
    "--resolver-order <order>",
    `Comma-separated resolver order (${DEFAULT_RESOLVER_ORDER.join(",")})`,
  )
  .option(
    "--generate-evidence",
    "Create and link evidence records for resolved work items",
    false,
  )
  .option("--dry-run", "Preview changes without writing files", false)
  .option("--strict", "Exit 1 if any errors are found", false)
  .option("--debug", "Enable verbose debug output", false)
  .action(async (opts) => {
    if (opts.reportFormat !== "text" && opts.reportFormat !== "json") {
      throw new Error(
        `Invalid --report-format value: ${opts.reportFormat}. Expected text or json.`,
      );
    }

    const resolverOrder =
      typeof opts.resolverOrder === "string"
        ? (opts.resolverOrder
            .split(",")
            .map((value: string) => value.trim())
            .filter(
              (value: string) => value.length > 0,
            ) as SubjectResolverName[])
        : undefined;

    const report = await scanBacklog({
      backlogDir: opts.dir,
      reportFormat: opts.reportFormat,
      strict: opts.strict,
      debug: opts.debug,
      resolverOrder,
      generateEvidence: opts.generateEvidence,
      dryRun: opts.dryRun,
      consumerConfig: opts.consumerConfig,
    });
    const output = formatScanReport(report);
    if (opts.outputFile) {
      const { promises: fs } = await import("node:fs");
      await fs.writeFile(opts.outputFile, output, "utf8");
    } else {
      console.log(output);
    }
    if (report.exitCode !== 0) {
      process.exit(report.exitCode);
    }
  });

const workItem = program
  .command("work-item")
  .description("Canonical work-item mutation commands");

workItem
  .command("transition")
  .description("Transition a work item to a new lifecycle status")
  .requiredOption("--id <id>", "Canonical work-item id")
  .requiredOption("--status <status>", "Target status")
  .option("--reason <reason>", "Status reason token/value")
  .option("--actual <hours>", "Actual effort in hours")
  .option("--assignee <assignee>", "Assignee or owner handle")
  .option("--completed-date <date>", "Completion date in YYYY-MM-DD form")
  .option("--consumer-config <path>", "Path to consumer config JSON")
  .option("--dry-run", "Show the mutation without writing files")
  .action(async (opts) => {
    let actual: number | undefined;
    if (opts.actual !== undefined) {
      const n = Number(opts.actual);
      if (!Number.isFinite(n)) {
        throw new Error(
          `--actual must be a valid finite number, got: "${opts.actual}"`,
        );
      }
      actual = n;
    }
    const result = await transitionWorkItem({
      id: opts.id,
      status: opts.status,
      statusReason: opts.reason,
      actual,
      assignee: opts.assignee,
      completedDate: opts.completedDate,
      consumerConfig: opts.consumerConfig,
      dryRun: opts.dryRun,
    });
    console.log(JSON.stringify(result, null, 2));
  });

workItem
  .command("link")
  .description("Attach a canonical link to a work item")
  .argument("<kind>", "Link kind: pr|evidence|reference")
  .requiredOption("--id <id>", "Canonical work-item id")
  .option("--url <url>", "External URL for PR links")
  .option("--ref <ref>", "Wikilink, file, or other reference")
  .option("--consumer-config <path>", "Path to consumer config JSON")
  .option("--dry-run", "Show the mutation without writing files")
  .action(async (kind: string, opts) => {
    const allowedKinds = ["pr", "evidence", "reference"] as const;
    if (!allowedKinds.includes(kind as (typeof allowedKinds)[number])) {
      throw new Error(
        `Invalid link kind "${kind}". Must be one of: ${allowedKinds.join(
          ", ",
        )}`,
      );
    }
    const value = opts.url ?? opts.ref;
    if (!value) {
      throw new Error("Provide --url or --ref for work-item link.");
    }
    const result = await linkWorkItem({
      id: opts.id,
      kind: kind as "pr" | "evidence" | "reference",
      value,
      consumerConfig: opts.consumerConfig,
      dryRun: opts.dryRun,
    });
    console.log(JSON.stringify(result, null, 2));
  });

workItem
  .command("record-commit")
  .description("Record an implementation commit against a work item")
  .requiredOption("--id <id>", "Canonical work-item id")
  .requiredOption("--sha <sha>", "Commit SHA")
  .requiredOption("--summary <summary>", "Short commit summary")
  .option("--consumer-config <path>", "Path to consumer config JSON")
  .option("--dry-run", "Show the mutation without writing files")
  .action(async (opts) => {
    const result = await recordWorkItemCommit({
      id: opts.id,
      sha: opts.sha,
      summary: opts.summary,
      consumerConfig: opts.consumerConfig,
      dryRun: opts.dryRun,
    });
    console.log(JSON.stringify(result, null, 2));
  });

workItem
  .command("finalize")
  .description("Finalize and archive a work item once closure evidence exists")
  .requiredOption("--id <id>", "Canonical work-item id")
  .option("--reason <reason>", "Closure reason")
  .option("--completed-date <date>", "Completion date in YYYY-MM-DD form")
  .option("--actual <hours>", "Actual effort in hours")
  .option("--consumer-config <path>", "Path to consumer config JSON")
  .option("--dry-run", "Show the mutation without writing files")
  .action(async (opts) => {
    let actual: number | undefined;
    if (opts.actual !== undefined) {
      const n = Number(opts.actual);
      if (!Number.isFinite(n)) {
        throw new Error(
          `--actual must be a valid finite number, got: "${opts.actual}"`,
        );
      }
      actual = n;
    }
    const result = await finalizeWorkItem({
      id: opts.id,
      statusReason: opts.reason,
      completedDate: opts.completedDate,
      actual,
      consumerConfig: opts.consumerConfig,
      dryRun: opts.dryRun,
    });
    console.log(JSON.stringify(result, null, 2));
  });

const record = program
  .command("record")
  .description("Canonical record creation commands");

record
  .command("create")
  .description("Create an append-only record artifact such as a test-result")
  .requiredOption("--summary <summary>", "Record summary")
  .requiredOption("--observation <observation>", "Primary record observation")
  .requiredOption(
    "--subject <subject>",
    "Subject wikilink or reference",
    collectOption,
  )
  .option("--id <id>", "Canonical record id")
  .option("--type <subtype>", "Record subtype, e.g. test-result")
  .option("--status <status>", "Lifecycle status")
  .option("--reason <reason>", "Status reason token/value")
  .option("--outcome <outcome>", "Outcome token, e.g. pass|fail|mixed|noted")
  .option("--recorded-at <timestamp>", "Record timestamp in ISO 8601 form")
  .option("--artifact-ref <ref>", "Artifact reference", collectOption, [])
  .option("--supporting-ref <ref>", "Supporting reference", collectOption, [])
  .option("--finding <finding>", "Finding line", collectOption, [])
  .option("--note <note>", "Additional note line", collectOption, [])
  .option("--consumer-config <path>", "Path to consumer config JSON")
  .option("--dry-run", "Show the mutation without writing files")
  .action(async (opts) => {
    const subjects = Array.isArray(opts.subject)
      ? opts.subject
      : [opts.subject];
    const result = await createWorkRecord({
      id: opts.id,
      summary: opts.summary,
      observation: opts.observation,
      subjects,
      subtype: opts.type,
      status: opts.status,
      statusReason: opts.reason,
      outcome: opts.outcome,
      recordedAt: opts.recordedAt,
      artifactRefs: opts.artifactRef,
      supportingRefs: opts.supportingRef,
      findings: opts.finding,
      notes: opts.note,
      consumerConfig: opts.consumerConfig,
      dryRun: opts.dryRun,
    });
    console.log(JSON.stringify(result, null, 2));
  });

// --- DOMAIN: governance ---
const governance = program
  .command("governance")
  .description(
    "Governance profiles (documentation systems and process models)",
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
          })),
        ),
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
        })),
      );
    } else if ("message" in (effective as any)) {
      console.log((effective as any).message);
    }
  });

governance
  .command("reconcile")
  .description(
    "Reconcile conflicts between selected governance profiles (placeholder implementation)",
  )
  .argument("<file>", "Markdown file path")
  .option(
    "--strategy <strategy>",
    "prompt|auto|prioritize|intersection|override|split|advisory",
    "prompt",
  )
  .option("--dry-run", "Show plan without applying changes")
  .action(
    async (file: string, opts: { strategy: string; dryRun?: boolean }) => {
      const plan = await governanceReconcile(file, {
        strategy: opts.strategy,
        dryRun: opts.dryRun,
      });
      console.log(JSON.stringify(plan, null, 2));
    },
  );

governance
  .command("migrate")
  .description(
    "Migrate legacy governanceProfiles/reconciliation to new governance structure (placeholder)",
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
