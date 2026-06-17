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
  validateArchiveWorkItems,
  formatArchiveValidationReport,
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
import {
  validate as validatePrdPayload,
  render as renderPrd,
} from "../lib/controllers/prdController.js";
import { validateFrontmatter as validateWorkManagementFrontmatter } from "../lib/work-management/frontmatter-lint.js";
import { main as runStatusReasonCompatibility } from "../lib/work-management/status-reason-compatibility.js";
import {
  claimTask,
  listTaskClaims,
  recoverClaim,
  getActiveClaimsForTask,
  getClaimStatus,
  formatReadyPorcelain,
  formatReadyText,
  loadTaskModel,
  readTaskRecordPayload,
  recordTaskEvidence,
  optionsFromTransitionPayload,
  releaseClaim,
  renderTaskPrompt,
  renderTaskView,
  readTaskTransitionPayload,
  selectReadyTasks,
  TaskCommandError,
  toTaskErrorPayload,
  transitionTask,
} from "../lib/task/index.js";

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

const collectCsvOption = (value: string, previous: string[] = []) => [
  ...previous,
  ...value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
];

function printTaskJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function failTaskCommand(error: unknown, json = false): never {
  if (json) {
    console.error(JSON.stringify(toTaskErrorPayload(error), null, 2));
  } else if (error instanceof TaskCommandError) {
    console.error(`${error.code}: ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
}

function assertTaskClaimable(task: Awaited<ReturnType<typeof loadTaskModel>>): void {
  const failures: string[] = [];
  if (!task.validation.isActive) failures.push("not-active");
  if (!task.validation.isReady) failures.push("not-ready");
  if (!task.validation.isAfk) failures.push("not-afk");
  if (task.validation.isHitl) failures.push("hitl");
  if (!task.validation.dependenciesSatisfied) {
    failures.push("dependencies-not-satisfied");
  }
  if (failures.length > 0) {
    throw new TaskCommandError(
      "TASK_NOT_CLAIMABLE",
      `Task '${task.id}' is not eligible for a local claim.`,
      { taskId: task.id, failures },
    );
  }
}

function parseTaskNumber(value: string | undefined, optionName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TaskCommandError(
      "TASK_INVALID_NUMBER",
      `${optionName} must be a finite number.`,
      { optionName, value },
    );
  }
  return parsed;
}

// --- DOMAIN: work-management ---
const workManagement = program
  .command("work-management")
  .description("Work-management standards and validation commands");

const workManagementSchemas = workManagement
  .command("schemas")
  .description("Manage the bundled work-management default schema suite");

workManagementSchemas
  .command("check")
  .description("Check generated work-management schemas for drift")
  .action(() => {
    const exitCode = runStatusReasonCompatibility(["--check"]);
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  });

workManagementSchemas
  .command("generate")
  .description("Regenerate derived work-management schemas")
  .action(() => {
    const exitCode = runStatusReasonCompatibility([]);
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  });

workManagement
  .command("lint-frontmatter")
  .description(
    "Validate backlog frontmatter against doc-vader work-management defaults",
  )
  .option(
    "--strict",
    "Promote semantic warnings unless consumer policy masks them",
  )
  .argument("[files...]", "Optional backlog markdown files to validate")
  .action((files: string[], opts: { strict?: boolean }) => {
    const args = [...(opts.strict ? ["--strict"] : []), ...(files ?? [])];
    const success = validateWorkManagementFrontmatter(args);
    if (!success) {
      process.exit(1);
    }
  });

// --- DOMAIN: task ---
const task = program
  .command("task")
  .description("Sandcastle dogfood task commands");

task
  .command("ready")
  .description("List fail-closed AFK-ready task candidates")
  .option("--json", "Emit deterministic candidate and exclusion JSON")
  .option("--porcelain", "Emit stable script-friendly candidate lines")
  .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
  .action(
    async (opts: { json?: boolean; porcelain?: boolean; backlogDir?: string }) => {
      try {
        if (opts.json && opts.porcelain) {
          throw new TaskCommandError(
            "TASK_READY_FORMAT_CONFLICT",
            "Use either --json or --porcelain, not both.",
          );
        }
        const report = await selectReadyTasks({ backlogDir: opts.backlogDir });
        if (opts.json) {
          printTaskJson(report);
          return;
        }
        const output = opts.porcelain
          ? formatReadyPorcelain(report)
          : formatReadyText(report);
        if (output.length > 0) {
          console.log(output);
        }
      } catch (error) {
        failTaskCommand(error, opts.json);
      }
    },
  );

task
  .command("show")
  .description("Show canonical task context")
  .argument("<task-id>", "Task id, numeric id, or task file basename")
  .option("--json", "Emit canonical task JSON")
  .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
  .action(async (taskId: string, opts: { json?: boolean; backlogDir?: string }) => {
    try {
      const model = await loadTaskModel(taskId, {
        backlogDir: opts.backlogDir,
      });
      if (opts.json) {
        printTaskJson(model);
        return;
      }
      console.log(await renderTaskView(model));
    } catch (error) {
      failTaskCommand(error, opts.json);
    }
  });

task
  .command("prompt")
  .description("Render a Sandcastle-oriented prompt from canonical task JSON")
  .argument("<task-id>", "Task id, numeric id, or task file basename")
  .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
  .action(async (taskId: string, opts: { backlogDir?: string }) => {
    try {
      const model = await loadTaskModel(taskId, {
        backlogDir: opts.backlogDir,
      });
      console.log(await renderTaskPrompt(model));
    } catch (error) {
      failTaskCommand(error);
    }
  });

task
  .command("claim")
  .description("Create a conservative local task claim")
  .argument("<task-id>", "Task id, numeric id, or task file basename")
  .option("--json", "Emit machine-readable JSON")
  .option("--holder <holder>", "Claim holder identity")
  .option("--branch <branch>", "Branch or ref context")
  .option("--sandbox <path>", "Sandbox or workspace path")
  .option("--ttl-minutes <minutes>", "Claim time-to-live in minutes")
  .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
  .action(
    async (
      taskId: string,
      opts: {
        json?: boolean;
        holder?: string;
        branch?: string;
        sandbox?: string;
        ttlMinutes?: string;
        backlogDir?: string;
      },
    ) => {
      try {
        const model = await loadTaskModel(taskId, {
          backlogDir: opts.backlogDir,
        });
        assertTaskClaimable(model);
        const ttlMinutes =
          typeof opts.ttlMinutes === "string"
            ? Number.parseInt(opts.ttlMinutes, 10)
            : undefined;
        if (ttlMinutes !== undefined && !Number.isFinite(ttlMinutes)) {
          throw new TaskCommandError(
            "TASK_CLAIM_INVALID_TTL",
            "Claim TTL must be a finite number of minutes.",
          );
        }
        const result = await claimTask(model.id, {
          holder: opts.holder,
          branch: opts.branch,
          sandbox: opts.sandbox,
          ttlMinutes,
        });
        if (opts.json) {
          printTaskJson(result);
          return;
        }
        console.log(`${result.claimId} ${result.state} ${result.taskId}`);
      } catch (error) {
        failTaskCommand(error, opts.json);
      }
    },
  );

task
  .command("status")
  .description("Report local task claim status")
  .requiredOption("--claim <claim-id>", "Claim id")
  .option("--json", "Emit machine-readable JSON")
  .action(async (opts: { claim: string; json?: boolean }) => {
    try {
      const result = await getClaimStatus(opts.claim);
      if (opts.json) {
        printTaskJson(result);
        return;
      }
      console.log(`${result.claimId} ${result.state}`);
    } catch (error) {
      failTaskCommand(error, opts.json);
    }
  });

task
  .command("claim-for")
  .description("Find the single active local claim for a task")
  .argument("<task-id>", "Task id, numeric id, or task file basename")
  .option("--json", "Emit machine-readable JSON")
  .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
  .action(
    async (taskId: string, opts: { json?: boolean; backlogDir?: string }) => {
      try {
        const model = await loadTaskModel(taskId, {
          backlogDir: opts.backlogDir,
        });
        const claims = await getActiveClaimsForTask(model.id);
        if (claims.length === 0) {
          throw new TaskCommandError(
            "TASK_CLAIM_NOT_FOUND",
            `Task '${model.id}' does not have an active claim.`,
            { taskId: model.id },
          );
        }
        if (claims.length > 1) {
          throw new TaskCommandError(
            "TASK_CLAIM_AMBIGUOUS",
            `Task '${model.id}' has multiple active claims.`,
            {
              taskId: model.id,
              claimIds: claims.map((claim) => claim.id),
            },
          );
        }
        const claim = claims[0]!;
        const result = {
          claimId: claim.id,
          taskId: claim.taskId,
          state: "active",
          claim,
        };
        if (opts.json) {
          printTaskJson(result);
          return;
        }
        console.log(`${result.claimId} ${result.state} ${result.taskId}`);
      } catch (error) {
        failTaskCommand(error, opts.json);
      }
    },
  );

task
  .command("claims")
  .description("List local task claims")
  .option("--json", "Emit machine-readable JSON")
  .action(async (opts: { json?: boolean }) => {
    try {
      const result = await listTaskClaims();
      if (opts.json) {
        printTaskJson({ claims: result });
        return;
      }
      for (const claim of result) {
        console.log(`${claim.claimId} ${claim.state} ${claim.taskId ?? ""}`);
      }
    } catch (error) {
      failTaskCommand(error, opts.json);
    }
  });

task
  .command("recover")
  .description("Inspect or deliberately recover an expired local task claim")
  .argument("<claim-id>", "Claim id")
  .option("--json", "Emit machine-readable JSON")
  .option(
    "--action <action>",
    "Recovery action: inspect, release, adopt, or abandon",
    "inspect",
  )
  .option("--holder <holder>", "Adopting claim holder identity")
  .option("--ttl-minutes <minutes>", "Adopted claim time-to-live in minutes")
  .option("--reason <reason>", "Abandonment reason")
  .option("--force", "Override recovery classification safety checks")
  .action(
    async (
      claimId: string,
      opts: {
        json?: boolean;
        action?: string;
        holder?: string;
        ttlMinutes?: string;
        reason?: string;
        force?: boolean;
      },
    ) => {
      try {
        if (!["inspect", "release", "adopt", "abandon"].includes(opts.action ?? "")) {
          throw new TaskCommandError(
            "TASK_RECOVERY_INVALID_ACTION",
            "Recovery action must be inspect, release, adopt, or abandon.",
            { action: opts.action },
          );
        }
        const ttlMinutes =
          typeof opts.ttlMinutes === "string"
            ? Number.parseInt(opts.ttlMinutes, 10)
            : undefined;
        if (ttlMinutes !== undefined && !Number.isFinite(ttlMinutes)) {
          throw new TaskCommandError(
            "TASK_RECOVERY_INVALID_TTL",
            "Recovery TTL must be a finite number of minutes.",
          );
        }
        const result = await recoverClaim(claimId, {
          action: opts.action as "inspect" | "release" | "adopt" | "abandon",
          holder: opts.holder,
          ttlMinutes,
          reason: opts.reason,
          force: opts.force,
        });
        if (opts.json) {
          printTaskJson(result);
          return;
        }
        console.log(
          `${result.claimId} ${result.state} ${result.classification}`,
        );
      } catch (error) {
        failTaskCommand(error, opts.json);
      }
    },
  );

task
  .command("release")
  .description("Release a local task claim")
  .requiredOption("--claim <claim-id>", "Claim id")
  .option("--json", "Emit machine-readable JSON")
  .action(async (opts: { claim: string; json?: boolean }) => {
    try {
      const result = await releaseClaim(opts.claim);
      if (opts.json) {
        printTaskJson(result);
        return;
      }
      console.log(`${result.claimId} ${result.state}`);
    } catch (error) {
      failTaskCommand(error, opts.json);
    }
  });

task
  .command("record")
  .description("Create and link claim-scoped task evidence")
  .requiredOption("--claim <claim-id>", "Active claim id")
  .requiredOption("--payload <json-file|->", "Record payload JSON file or stdin")
  .option("--json", "Emit machine-readable JSON")
  .option(
    "--consumer-config <path>",
    "Path to consumer config JSON",
    ".doc-vader/backlog-consumer.json",
  )
  .option("--dry-run", "Validate and render mutation without writing files")
  .action(
    async (opts: {
      claim: string;
      payload: string;
      json?: boolean;
      consumerConfig?: string;
      dryRun?: boolean;
    }) => {
      try {
        const payload = await readTaskRecordPayload(opts.payload, process.stdin);
        const result = await recordTaskEvidence({
          claimId: opts.claim,
          payload,
          consumerConfig: opts.consumerConfig,
          dryRun: opts.dryRun,
        });
        if (opts.json) {
          printTaskJson(result);
          return;
        }
        console.log(`${result.taskId} ${result.evidenceLink}`);
      } catch (error) {
        failTaskCommand(error, opts.json);
      }
    },
  );

task
  .command("transition")
  .description("Transition a claimed task using the work-management profile")
  .requiredOption("--claim <claim-id>", "Active claim id")
  .option("--status <status>", "Target work-management status")
  .option("--reason <reason>", "Target status reason")
  .option("--actual <hours>", "Actual effort in hours")
  .option("--assignee <assignee>", "Assignee or owner handle")
  .option("--completed-date <date>", "Completion date in YYYY-MM-DD form")
  .option("--payload <json-file|->", "Transition payload JSON file or stdin")
  .option("--json", "Emit machine-readable JSON")
  .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
  .option(
    "--consumer-config <path>",
    "Path to consumer config JSON",
    ".doc-vader/backlog-consumer.json",
  )
  .option("--dry-run", "Validate and render mutation without writing files")
  .action(
    async (opts: {
      claim: string;
      status?: string;
      reason?: string;
      actual?: string;
      assignee?: string;
      completedDate?: string;
      payload?: string;
      json?: boolean;
      backlogDir?: string;
      consumerConfig?: string;
      dryRun?: boolean;
    }) => {
      try {
        const flagFields = [
          opts.status,
          opts.reason,
          opts.actual,
          opts.assignee,
          opts.completedDate,
        ].filter((value) => value !== undefined);
        if (opts.payload && flagFields.length > 0) {
          throw new TaskCommandError(
            "TASK_TRANSITION_ARGUMENT_CONFLICT",
            "Use either --payload or transition flags, not both.",
          );
        }
        const payloadOptions = opts.payload
          ? optionsFromTransitionPayload(
              await readTaskTransitionPayload(opts.payload, process.stdin),
            )
          : undefined;
        const status = payloadOptions?.status ?? opts.status;
        if (!status) {
          throw new TaskCommandError(
            "TASK_TRANSITION_INVALID_TARGET",
            "Transition target status is required.",
          );
        }
        const result = await transitionTask({
          claimId: opts.claim,
          status,
          expectedFromStatus: payloadOptions?.expectedFromStatus,
          statusReason: payloadOptions?.statusReason ?? opts.reason,
          actual:
            payloadOptions?.actual ?? parseTaskNumber(opts.actual, "--actual"),
          assignee: payloadOptions?.assignee ?? opts.assignee,
          completedDate: payloadOptions?.completedDate ?? opts.completedDate,
          backlogDir: opts.backlogDir,
          consumerConfig: opts.consumerConfig,
          dryRun: opts.dryRun,
        });
        if (opts.json) {
          printTaskJson(result);
          return;
        }
        console.log(
          `${result.taskId} ${result.fromStatus}->${result.toStatus}`,
        );
      } catch (error) {
        failTaskCommand(error, opts.json);
      }
    },
  );

task
  .command("close")
  .description("Mark a claimed task completed without finalizing or archiving it")
  .requiredOption("--claim <claim-id>", "Active claim id")
  .option("--reason <reason>", "Completion status reason", "completed")
  .option("--actual <hours>", "Actual effort in hours")
  .option("--assignee <assignee>", "Assignee or owner handle")
  .option("--completed-date <date>", "Completion date in YYYY-MM-DD form")
  .option("--json", "Emit machine-readable JSON")
  .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
  .option(
    "--consumer-config <path>",
    "Path to consumer config JSON",
    ".doc-vader/backlog-consumer.json",
  )
  .option("--dry-run", "Validate and render mutation without writing files")
  .action(
    async (opts: {
      claim: string;
      reason?: string;
      actual?: string;
      assignee?: string;
      completedDate?: string;
      json?: boolean;
      backlogDir?: string;
      consumerConfig?: string;
      dryRun?: boolean;
    }) => {
      try {
        const result = await transitionTask({
          claimId: opts.claim,
          status: "completed",
          statusReason: opts.reason,
          actual: parseTaskNumber(opts.actual, "--actual"),
          assignee: opts.assignee,
          completedDate: opts.completedDate,
          backlogDir: opts.backlogDir,
          consumerConfig: opts.consumerConfig,
          dryRun: opts.dryRun,
        });
        if (opts.json) {
          printTaskJson(result);
          return;
        }
        console.log(
          `${result.taskId} ${result.fromStatus}->${result.toStatus}`,
        );
      } catch (error) {
        failTaskCommand(error, opts.json);
      }
    },
  );

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

const backlogArchive = backlog
  .command("archive")
  .description("Archive validation commands");

backlogArchive
  .command("validate")
  .description("Validate archived work items using configured archive roots")
  .option("-f, --format <format>", "Output format: text|json", "text")
  .option(
    "--consumer-config <path>",
    "Path to consumer config JSON",
    ".doc-vader/backlog-consumer.json",
  )
  .option("--fail-on <level>", "Fail level for exit code: error|warning", "error")
  .action(
    async (opts: {
      format: string;
      consumerConfig: string;
      failOn: "error" | "warning";
    }) => {
      try {
        const report = await validateArchiveWorkItems({
          format: opts.format as "text" | "json",
          consumerConfig: opts.consumerConfig,
          failOn: opts.failOn,
        });
        const output = formatArchiveValidationReport(report);
        console.log(output);
        if (report.exitCode !== 0) {
          process.exit(report.exitCode);
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    }
  );

backlog
  .command("validate")
  .description("Validate backlog items")
  .option("-d, --dir <path>", "Path to the backlog directory", "backlog")
  .option("--format <format>", "Output format: text|json")
  .option("--fail-on <level>", "Fail level for exit code: error|warning")
  .option(
    "--profile <nameOrPath...>",
    "Validation profile name(s) or JSON profile path(s); repeat or use comma-separated values (default|strict|ci)",
    collectCsvOption,
    [],
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
    const selectedProfiles =
      Array.isArray(opts.profile) && opts.profile.length > 0
        ? opts.profile
        : undefined;
    const report = await validateBacklog({
      backlogDir: opts.dir,
      format: opts.format,
      failOn: opts.failOn,
      profile: selectedProfiles?.[0],
      profiles: selectedProfiles,
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
  .option(
    "--validate-archive-candidates",
    "Validate ready-for-review/closed candidates and archive eligible work items",
    false,
  )
  .option(
    "--invalid-candidate-status <status>",
    "Optional status to set on invalid candidates (use 'none' to disable updates)",
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
      validateArchiveCandidates: opts.validateArchiveCandidates,
      invalidCandidateStatus: opts.invalidCandidateStatus,
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

const prd = program
  .command("prd")
  .description("Product requirements document lifecycle commands");

prd
  .command("validate")
  .description("Validate a PRD JSON content payload")
  .requiredOption("--payload <path>", "Path to PRD content JSON payload")
  .addOption(
    new Option("--format <format>", "Output format")
      .choices(["text", "json"])
      .default("text"),
  )
  .action(async (opts) => {
    const result = await validatePrdPayload({
      payloadPath: opts.payload,
    });
    if (opts.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.valid) {
      console.log(`PRD payload valid: ${result.payloadPath}`);
    } else {
      console.error(`PRD payload invalid: ${result.payloadPath}`);
      console.error(JSON.stringify(result.errors, null, 2));
    }
    if (!result.valid) {
      process.exit(1);
    }
  });

prd
  .command("render")
  .description("Render a PRD Markdown view from a validated JSON payload")
  .requiredOption("--payload <path>", "Path to PRD content JSON payload")
  .requiredOption("--id <id>", "Canonical PRD plan id, e.g. plan:my-prd")
  .requiredOption("--title <title>", "Human-readable PRD title")
  .requiredOption("--summary <summary>", "Short PRD summary")
  .option("--template <path>", "PRD Markdown template path")
  .option("--output <path>", "Path to write rendered Markdown")
  .option("--json-output <path>", "Path to preserve/copy JSON payload")
  .option("--lifecycle <lifecycle>", "Document lifecycle", "active")
  .option("--status <status>", "Document status", "ready")
  .option("--reason <reason>", "Status reason")
  .option("--owner <owner>", "Owner or responsible party")
  .option("--assignee <assignee>", "Assignee")
  .option("--tag <tag>", "Tag to include in frontmatter", collectOption, [])
  .action(async (opts) => {
    const result = await renderPrd({
      payloadPath: opts.payload,
      templatePath: opts.template,
      outputPath: opts.output,
      jsonOutputPath: opts.jsonOutput,
      id: opts.id,
      title: opts.title,
      summary: opts.summary,
      lifecycle: opts.lifecycle,
      status: opts.status,
      statusReason: opts.reason,
      owner: opts.owner,
      assignee: opts.assignee,
      tags: opts.tag,
    });
    if (result.markdown) {
      console.log(result.markdown);
    } else {
      console.log(
        JSON.stringify(
          {
            payloadPath: result.payloadPath,
            templatePath: result.templatePath,
            outputPath: result.outputPath,
            jsonOutputPath: result.jsonOutputPath,
            valid: result.validation.valid,
          },
          null,
          2,
        ),
      );
    }
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
    "Reconcile conflicts between selected governance profiles using deterministic priority-order strategy",
  )
  .argument("<file>", "Markdown file path")
  .option(
    "--strategy <strategy>",
    "priority-order|prioritize|auto|deterministic",
    "priority-order",
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
