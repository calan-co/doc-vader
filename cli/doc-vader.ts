#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { Command, Option } from "commander";
import os from "node:os";
import path from "node:path";
import {
  assertClaimAuthorityAvailable,
  ClaimAuthorityUnavailableError,
  initializeClaimAuthority,
} from "../lib/claim/index.js";
import {
  createRuntimeClaimCommandApi,
  resolveRuntimeClaimAuthority,
} from "../lib/runtime-claim/index.js";
import { isOperationalArtifact } from "../lib/operational-artifacts.js";
import { readRecordPayload } from "../lib/task/record.js";
import { collectBranchDiffPaths } from "../lib/task/recovery-state.js";
import {
  getRuntimeClaimDefaultTtlMilliseconds,
  type RuntimeClaimCleanupConflictDetail,
  type RuntimeClaimCleanupResult,
  type RuntimeClaimRecord,
  type RuntimeExecutionTerminalResult,
  type RuntimeLockConflictDetail,
  type RuntimeLockRemovalResult,
  type RuntimeLockStatusResult,
} from "../lib/runtime/index.js";

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
  runBacklogReview,
  formatBacklogReviewReportJson,
  formatBacklogReviewReportText,
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
  inspectQualifiers as inspectWorkItemQualifiers,
  attestQualifier as attestWorkItemQualifier,
  mutateQualifier as mutateWorkItemQualifier,
} from "../lib/controllers/workManagementController.js";
import {
  validate as validatePrdPayload,
  render as renderPrd,
} from "../lib/controllers/prdController.js";
import {
  installDocVaderExtension,
  listInstalledExtensions,
  registerConfiguredExtensions,
  uninstallDocVaderExtension,
} from "../lib/extensions/loader.js";
import {
  createEscalation,
  getEscalation,
} from "../lib/escalation/index.js";
import {
  CLAIM_RELEASE_OUTCOMES,
  claimWorkCommand,
  completeWorkChecklistCheckCommand,
  inspectWorkChecklistCommand,
  inspectWorkChecklistsCommand,
  mutateWorkChecklistCheckCommand,
  promptWorkCommand,
  recordWorkCommand,
  recoverWorkCommand,
  releaseClaimCommand,
  repairGeneratedEvidenceCommand,
  renderWorkShowCommand,
  showWorkCommand,
  statusWorkCommand,
  updateWorkCommand,
  updateWorkFromInputCommand,
} from "../lib/work/command-operations.js";
import { validateFrontmatter as validateWorkManagementFrontmatter } from "../lib/work-management/frontmatter-lint.js";
import { main as runStatusReasonCompatibility } from "../lib/work-management/status-reason-compatibility.js";
import {
  claimWork as claimTask,
  assertWorkClaimable as assertTaskClaimable,
  adaptWorkGraphExportToCytoscape,
  assertWorkGraphExportResult,
  createWorkGraphOutputExtension,
  exportWorkGraph,
  inspectWorkGraphNode,
  loadWorkModel as loadTaskModel,
  formatWorkStatusText as formatTaskStatusText,
  listWorkModels as listTaskModels,
  projectWorkGraph,
  queryWorkGraphEdges,
  queryWorkGraphNodes,
  readWorkGraphExportFile,
  renderStandaloneWorkGraphViewer,
  formatReadyPorcelain,
  formatReadyText,
  selectReadyWorkItems as selectReadyTasks,
  selectPublishedWork,
  discoverPublishedWorkSelectionCapabilities,
  formatPublishedWorkSelectionCommand,
  summarizeWorkGraphProjection,
  resolveWorkRoot as resolveGitRoot,
  type WorkModel as TaskModel,
  type WorkGraphEdgeType,
  type WorkGraphExplorerResult,
  type WorkGraphExportResult,
  type WorkGraphExportFormat,
  type WorkGraphExplorerFormat,
  type WorkGraphNodeType,
  type WorkGraphSummaryFormat,
  WorkCommandError as TaskCommandError,
  toWorkErrorPayload as toTaskErrorPayload,
} from "../lib/work/index.js";

const program = new Command()
  .name("doc-vader")
  .description(
    "Doc-Vader CLI - documentation automation, validation, and utilities"
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

function printTaskPorcelain(lines: string[]): void {
  console.log(lines.join("\t"));
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

function parseOptionalFiniteMinutes(
  value: string | undefined
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsedMinutes = Number.parseInt(value, 10);
  if (!Number.isFinite(parsedMinutes)) {
    throw new TaskCommandError(
      "CLAIM_INVALID_TTL",
      "Claim TTL must be a finite number of minutes.",
      { ttlMinutes: value }
    );
  }
  return parsedMinutes;
}

function recoveryForceHelp(): string {
  return [
    "Resolve dirty paths during recovery.",
    "reset discards recoverable dirty paths.",
    "reconcile saves a checkpoint before discarding recoverable dirty paths.",
  ].join(" ");
}

const WORK_GRAPH_NODE_TYPES = [
  "work-item",
  "claim",
  "record",
  "scope",
] as const satisfies readonly WorkGraphNodeType[];

const WORK_GRAPH_EDGE_TYPES = [
  "depends_on",
  "belongs_to",
  "implements",
  "locks",
  "records",
  "references",
] as const satisfies readonly WorkGraphEdgeType[];

const WORK_GRAPH_QUERY_FORMATS = [
  "json",
  "dot",
] as const satisfies readonly WorkGraphExplorerFormat[];
const WORK_GRAPH_SUMMARY_FORMATS = [
  "table",
  "json",
] as const satisfies readonly WorkGraphSummaryFormat[];
const WORK_GRAPH_EXPORT_FORMATS = [
  "json",
  "dot",
] as const satisfies readonly WorkGraphExportFormat[];

function parseGraphValues<T extends string>(
  values: string[] | undefined,
  allowedValues: readonly T[],
  errorCode: string,
  errorMessage: string,
  errorPayloadKey: string,
): T[] {
  const allowed = new Set<string>(allowedValues);
  return [...new Set(values)].map((value) => {
    if (!allowed.has(value)) {
      throw new TaskCommandError(
        errorCode,
        errorMessage,
        { [errorPayloadKey]: value },
      );
    }
    return value as T;
  });
}

function parseGraphNodeTypes(values: string[] = []): WorkGraphNodeType[] {
  return parseGraphValues(
    values,
    WORK_GRAPH_NODE_TYPES,
    "WORK_GRAPH_INVALID_NODE_TYPE",
    `Work graph node type must be one of ${WORK_GRAPH_NODE_TYPES.join(", ")}.`,
    "nodeType",
  );
}

function parseGraphEdgeTypes(values: string[] = []): WorkGraphEdgeType[] {
  return parseGraphValues(
    values,
    WORK_GRAPH_EDGE_TYPES,
    "WORK_GRAPH_INVALID_EDGE_TYPE",
    `Work graph edge type must be one of ${WORK_GRAPH_EDGE_TYPES.join(", ")}.`,
    "edgeType",
  );
}

function createWorkGraphFormatOption<T extends string>(
  formats: readonly T[],
  defaultFormat: T,
): Option {
  return new Option("--format <format>", "Output format")
    .choices([...formats])
    .default(defaultFormat);
}

async function writeProjectedWorkGraph(
  format: WorkGraphExplorerFormat,
  selectResult: (
    projection: Awaited<ReturnType<typeof projectWorkGraph>>,
  ) => WorkGraphExplorerResult,
): Promise<void> {
  try {
    const projection = await projectWorkGraph();
    const result = selectResult(projection);
    const output = createWorkGraphOutputExtension(format).render(result);
    process.stdout.write(output);
  } catch (error) {
    failTaskCommand(error, format === "json");
  }
}

function readTextStream(input: NodeJS.ReadStream): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let buffer = "";
    input.setEncoding("utf8");
    input.on("data", (chunk) => {
      buffer += chunk;
    });
    input.on("end", () => resolve(buffer));
    input.on("error", reject);
  });
}

function isInlineJsonCandidate(value: string): boolean {
  const trimmed = value.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function parseWorkGraphVisualizationInput(
  raw: string,
  source: string,
): WorkGraphExportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new TaskCommandError(
      "WORK_GRAPH_EXPORT_INVALID_JSON",
      `Work graph visualization ${source} is not valid JSON.`,
      { source, cause: error instanceof Error ? error.message : String(error) },
    );
  }
  return assertWorkGraphExportResult(parsed);
}

async function readWorkGraphVisualizationSource(
  input: string | undefined,
  stdin: NodeJS.ReadStream,
): Promise<WorkGraphExportResult> {
  if (!input || input.trim().length === 0) {
    return exportWorkGraph(await projectWorkGraph());
  }
  if (input === "-") {
    return parseWorkGraphVisualizationInput(
      await readTextStream(stdin),
      "stdin payload",
    );
  }
  if (isInlineJsonCandidate(input)) {
    return parseWorkGraphVisualizationInput(input, "inline payload");
  }
  return readWorkGraphExportFile(path.resolve(input));
}

function resolveBrowserOpenCommand(
  filePath: string,
): { command: string; args: string[] } {
  switch (process.platform) {
    case "darwin":
      return { command: "open", args: [filePath] };
    case "win32":
      return { command: "cmd", args: ["/c", "start", "", filePath] };
    default:
      return { command: "xdg-open", args: [filePath] };
  }
}

function tryOpenWorkGraphViewer(filePath: string): boolean {
  const opener = resolveBrowserOpenCommand(filePath);
  try {
    execFileSync(opener.command, opener.args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function reportVisualizationStatus(message: string): void {
  if (process.stderr.isTTY) {
    process.stderr.write(`${message}\n`);
  }
}

async function writeWorkGraphVisualizationHtml(
  html: string,
  output: string | undefined,
): Promise<void> {
  if (output === "-") {
    process.stdout.write(html);
    return;
  }

  if (output && output.trim().length > 0) {
    const outputPath = path.resolve(output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, html, "utf8");
    reportVisualizationStatus(`Work graph viewer written to ${outputPath}`);
    return;
  }

  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "doc-vader-work-graph-viewer-"),
  );
  const outputPath = path.join(tempDir, "index.html");
  await fs.writeFile(outputPath, html, "utf8");

  if (tryOpenWorkGraphViewer(outputPath)) {
    reportVisualizationStatus(`Opened work graph viewer in browser: ${outputPath}`);
    return;
  }

  reportVisualizationStatus(
    `Work graph viewer written to temporary file: ${outputPath}`,
  );
}

function runtimeRootDir(): string {
  return resolveRuntimeClaimAuthority(process.cwd()).rootDir;
}

function assertWorkClaimAuthority(rootDir: string): void {
  try {
    assertClaimAuthorityAvailable({ rootDir });
  } catch (error) {
    if (error instanceof ClaimAuthorityUnavailableError) {
      throw new TaskCommandError(error.code, error.message, { rootDir });
    }
    throw error;
  }
}

/** Claim and lock CLI projections use the Runtime Claim package command API. */
function runtimeClaimCommands(rootDir: string) {
  return createRuntimeClaimCommandApi({ rootDir });
}

/** Resolve and require the shared Claim authority before lifecycle SQLite access. */
function claimLifecycleAuthorityRootDir(): string {
  const rootDir = runtimeRootDir();
  initializeClaimAuthority({ rootDir });
  return rootDir;
}

function parseTimeFilter(filter: string): Date {
  const normalized = filter.trim().toLowerCase();
  if (!normalized.startsWith("until=")) {
    throw new TaskCommandError(
      "CLAIM_INVALID_FILTER",
      "Time filter must be one of until=now, until=24h, until=60m, or until=60s.",
      { filter }
    );
  }
  const unit = normalized.slice("until=".length);
  const now = new Date();
  switch (unit) {
    case "now":
      return now;
    case "24h":
      return new Date(now.getTime() + 24 * 60 * 60_000);
    case "60m":
      return new Date(now.getTime() + 60 * 60_000);
    case "60s":
      return new Date(now.getTime() + 60_000);
    default:
      throw new TaskCommandError(
        "CLAIM_INVALID_FILTER",
        "Time filter must be one of until=now, until=24h, until=60m, or until=60s.",
        { filter }
      );
  }
}

function parseClaimTarget(target: string): {
  targetType: string;
  targetId: string;
} {
  const normalized = target.trim();
  const [targetType, ...rest] = normalized.split(":");
  const targetId = rest.join(":").trim();
  if (!targetType || !targetId) {
    throw new TaskCommandError(
      "CLAIM_INVALID_TARGET",
      "Target must use the form <type>:<id>.",
      { target }
    );
  }
  if (targetType !== "task" && targetType !== "repair") {
    throw new TaskCommandError(
      "CLAIM_INVALID_TARGET",
      "Target must be task:<task-id> or repair:<completed-work-item-id>.",
      { target }
    );
  }
  if (targetType === "repair" && !/^wi-\d+$/i.test(targetId)) {
    throw new TaskCommandError(
      "CLAIM_INVALID_TARGET",
      "Repair targets must name a numeric Work Item id, e.g. repair:wi-005.",
      { target }
    );
  }
  return { targetType, targetId };
}

function formatRuntimeClaimLine(claim: RuntimeClaimRecord): string {
  return `${claim.claim_token} ${claim.state} ${claim.target_type}:${claim.target_id} ${claim.holder}`;
}

function formatRuntimeClaimStatusText(
  claim: RuntimeClaimRecord | undefined,
  claimToken?: string
): string {
  if (!claim) {
    return claimToken ? `missing ${claimToken}` : "missing";
  }
  return formatRuntimeClaimLine(claim);
}

function formatRuntimeClaimListText(claims: RuntimeClaimRecord[]): string {
  return claims.map((claim) => formatRuntimeClaimLine(claim)).join("\n");
}

type TaskListEntry = Awaited<ReturnType<typeof listTaskModels>>[number];

function formatTaskListText(tasks: TaskListEntry[]): string {
  if (tasks.length === 0) {
    return "No open tasks.";
  }
  return tasks
    .map((task) => `${task.id} | ${task.status} | ${task.title}`)
    .join("\n");
}

function formatTaskListPorcelain(tasks: TaskListEntry[]): string {
  return tasks
    .map((task) =>
      [task.id, task.status, task.title.replace(/\s+/g, " ").trim()].join("\t")
    )
    .join("\n");
}

function formatRuntimeExecutionTerminalText(
  result: RuntimeExecutionTerminalResult
): string {
  return `${result.claimToken} ${result.executionLogEntry.state} ${result.executionLogEntry.reason}`;
}

function formatRuntimeRecoveryText(result: {
  claimToken?: string;
  taskId: string;
  dryRun?: boolean;
  warnings?: string[];
  checkpoint?: { filePath: string; mode: string };
  plannedInitialLockPaths?: string[];
  plannedCheckpoint?: { mode: string; directory: string };
}): string {
  if (result.dryRun) {
    const lockText =
      result.plannedInitialLockPaths &&
      result.plannedInitialLockPaths.length > 0
        ? ` locks=${result.plannedInitialLockPaths.join(",")}`
        : "";
    const checkpointText = result.plannedCheckpoint
      ? ` checkpoint=${result.plannedCheckpoint.mode}:${result.plannedCheckpoint.directory}`
      : "";
    const warningText =
      result.warnings && result.warnings.length > 0
        ? ` warnings=${result.warnings.join(",")}`
        : "";
    return `dry-run recovered ${result.taskId}${lockText}${checkpointText}${warningText}`;
  }
  const checkpointText = result.checkpoint
    ? ` checkpoint=${result.checkpoint.mode}:${result.checkpoint.filePath}`
    : "";
  const warningText =
    result.warnings && result.warnings.length > 0
      ? ` warnings=${result.warnings.join(",")}`
      : "";
  return `${result.claimToken ?? "unknown"} recovered ${
    result.taskId
  }${checkpointText}${warningText}`;
}

function formatRecordCreationText(result: {
  id: string;
  filePath: string;
  dryRun: boolean;
}): string {
  return `${result.id} ${result.dryRun ? "preview" : "created"} ${
    result.filePath
  }`;
}

function formatRecordPorcelain(result: {
  id: string;
  filePath: string;
  dryRun: boolean;
}): string {
  return [
    result.id,
    result.filePath,
    result.dryRun ? "dry-run" : "written",
  ].join("\t");
}

function formatClaimCompletionText(result: {
  claimId: string;
  taskId: string;
  dryRun: boolean;
}): string {
  return `${result.claimId} ${result.taskId} ${
    result.dryRun ? "preview" : "completed"
  }`;
}

function formatRuntimeClaimCreationText(
  result: ReturnType<ReturnType<typeof runtimeClaimCommands>["acquireClaim"]>,
): string {
  return `${result.claimToken} ${result.executionLogEntry.state} ${result.executionLogEntry.reason}`;
}

function createRuntimeClaim(
  target: { targetType: string; targetId: string },
  opts: { rootDir?: string; holder?: string; branch?: string; worktree?: string; ttlMinutes?: number; initialLockPaths?: string[] },
): ReturnType<ReturnType<typeof runtimeClaimCommands>["acquireClaim"]> {
  const now = new Date();
  const ttlMilliseconds = opts.ttlMinutes === undefined ? getRuntimeClaimDefaultTtlMilliseconds() : opts.ttlMinutes * 60_000;
  return runtimeClaimCommands(resolveGitRoot(opts.rootDir)).acquireClaim({
    schema_version: "runtime-entity/v1", target_type: target.targetType, target_id: target.targetId,
    holder: opts.holder?.trim() || "local-agent", created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMilliseconds).toISOString(),
    ...(opts.branch || opts.worktree ? { metadata: { ...(opts.branch ? { branch: opts.branch } : {}), ...(opts.worktree ? { worktree: opts.worktree } : {}) } } : {}),
    entropy: randomUUID(),
  }, opts.initialLockPaths ?? []);
}

function collectChangedPaths(rootDir: string): string[] {
  try {
    const output = execFileSync("git", ["status", "--porcelain=v1", "-uall"], { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (!output) return [];
    const paths = new Set<string>();
    for (const line of output.split("\n")) {
      const rawPath = line.trimEnd().slice(3).trim();
      const pathValue = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() ?? "" : rawPath;
      if (pathValue) paths.add(pathValue);
    }
    return [...paths].sort();
  } catch {
    return [];
  }
}

function initialClaimLockPaths(rootDir: string, taskFilePath: string): string[] {
  const taskPath = path.relative(rootDir, taskFilePath).split(path.sep).join("/");
  return [...new Set([taskPath, ...collectBranchDiffPaths(rootDir), ...collectChangedPaths(rootDir)])]
    .filter((entry) => entry.length > 0 && !isOperationalArtifact(entry))
    .sort();
}

// --- DOMAIN: claim ---
const claim = program
  .command("claim")
  .description("Runtime claim command surface")
  .showHelpAfterError(true);

claim.action(async () => {
  try {
    const claims = runtimeClaimCommands(runtimeRootDir())
      .listClaims()
      .filter((entry) => entry.state === "active");
    const text = formatRuntimeClaimListText(claims);
    if (text.length > 0) {
      console.log(text);
    }
  } catch (error) {
    failTaskCommand(error);
  }
});

claim
  .command("status")
  .description("Show claim status for one claim or a filtered claim set")
  .argument("[claim-token]", "Claim token to inspect")
  .option("--filter <time-filter>", "Filter claim status by expiry time")
  .option("--json", "Emit machine-readable JSON")
  .action(
    async (
      claimToken: string | undefined,
      opts: { filter?: string; json?: boolean }
    ) => {
      try {
        if (!claimToken && !opts.filter) {
          throw new TaskCommandError(
            "CLAIM_INVALID_SELECTOR",
            "Provide a claim token or --filter to inspect claims."
          );
        }
        if (claimToken && opts.filter) {
          throw new TaskCommandError(
            "CLAIM_INVALID_SELECTOR",
            "Use either a claim token or --filter, not both."
          );
        }

        const commands = runtimeClaimCommands(runtimeRootDir());
        if (opts.filter) {
          const cutoff = parseTimeFilter(opts.filter);
          const claims = commands
            .listClaims()
            .filter(
              (entry) => Date.parse(entry.expires_at) <= cutoff.getTime()
            )
            .sort((left, right) => {
              return (
                Date.parse(left.expires_at) - Date.parse(right.expires_at)
              );
            });
          if (opts.json) {
            printTaskJson({ claims });
          } else {
            const text = formatRuntimeClaimListText(claims);
            if (text.length > 0) {
              console.log(text);
            }
          }
          return;
        }

        const claim = commands.getClaimStatus(claimToken!);
        if (opts.json) {
          printTaskJson({
            claimToken,
            state: claim?.state ?? "missing",
            claim: claim ?? null,
          });
        } else {
          console.log(formatRuntimeClaimStatusText(claim, claimToken));
        }
      } catch (error) {
        failTaskCommand(error, opts.json);
      }
    }
  );

claim
  .command("create")
  .description("Create a runtime claim for a task or completed-artifact repair target")
  .requiredOption(
    "--target <target>",
    "Claim target: task:<task-id> or repair:<completed-work-item-id>"
  )
  .option("--holder <holder>", "Claim holder identity")
  .option("--branch <branch>", "Branch or ref context")
  .option("--worktree <path>", "Worktree path")
  .option("--ttl-minutes <minutes>", "Claim time-to-live in minutes")
  .option("--json", "Emit machine-readable JSON")
  .action(
    async (opts: {
      target: string;
      holder?: string;
      branch?: string;
      worktree?: string;
      ttlMinutes?: string;
      json?: boolean;
    }) => {
      try {
        const target = parseClaimTarget(opts.target);
        const model = target.targetType === "task"
          ? await loadTaskModel(target.targetId, {})
          : undefined;
        if (model) assertTaskClaimable(model);
        const ttlMinutes = parseOptionalFiniteMinutes(opts.ttlMinutes);
        const result = createRuntimeClaim(target, {
          holder: opts.holder,
          branch: opts.branch,
          worktree: opts.worktree,
          ttlMinutes,
          initialLockPaths: model
            ? initialClaimLockPaths(process.cwd(), model.filePath)
            : [],
        });

        if (opts.json) {
          printTaskJson(result);
          if (result.outcome === "conflict") {
            process.exit(1);
          }
          return;
        }
        if (result.outcome === "conflict") {
          console.error(formatRuntimeClaimCreationText(result));
          process.exit(1);
          return;
        }
        console.log(formatRuntimeClaimCreationText(result));
      } catch (error) {
        failTaskCommand(error, opts.json);
      }
    }
  );

claim
  .command("renew")
  .description("Renew an active runtime claim lease")
  .argument("<claim-token>", "Claim token to renew")
  .option("--json", "Emit machine-readable JSON")
  .action(async (claimToken: string, opts: { json?: boolean }) => {
    try {
      const result = runtimeClaimCommands(claimLifecycleAuthorityRootDir())
        .renewClaim(claimToken);
      if (opts.json) {
        printTaskJson(result);
      } else if (result.outcome === "renewed") {
        console.log(`${result.claimToken} renewed`);
      } else {
        console.error(`${result.claimToken} renewal conflict`);
      }
      if (result.outcome === "conflict") {
        process.exitCode = 1;
      }
    } catch (error) {
      failTaskCommand(error, opts.json);
    }
  });

claim
  .command("release")
  .description("Release a claim with an explicit outcome")
  .argument("<claim-token>", "Claim token to release")
  .requiredOption(
    "--outcome <outcome>",
    `Release outcome: ${CLAIM_RELEASE_OUTCOMES.join("|")}`
  )
  .option(
    "--code <code>",
    "Structured detail code for non-success outcomes",
    "x-runtime-claim-released"
  )
  .option("--message <message>", "Human-readable release detail")
  .option("--actual <hours>", "Actual effort in hours for successful close")
  .option("--json", "Emit machine-readable JSON")
  .option("--porcelain", "Emit stable script-friendly output for success")
  .option(
    "--dry-run",
    "Validate and render success mutation without writing files"
  )
  .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
  .option(
    "--consumer-config <path>",
    "Path to consumer config JSON",
    ".doc-vader/backlog-consumer.json"
  )
  .action(
    async (
      claimToken: string,
      opts: {
        outcome: string;
        code: string;
        message?: string;
        json?: boolean;
        porcelain?: boolean;
        dryRun?: boolean;
        backlogDir?: string;
        consumerConfig?: string;
        actual?: string;
      }
    ) => {
      try {
        const released = await releaseClaimCommand(claimToken, opts);
        if (opts.json) {
          printTaskJson(released.result);
          return;
        }
        if (released.outcome === "success") {
          if (opts.porcelain) {
            printTaskPorcelain([released.result.claimId, released.result.taskId, released.result.dryRun ? "dry-run" : "released"]);
            return;
          }
          console.log(formatClaimCompletionText(released.result));
          return;
        }
        if (released.outcome === "failed") {
          console.log(formatRuntimeExecutionTerminalText(released.result));
          return;
        }
        console.log(`${released.result.claimToken} released ${released.result.executionLogEntry.reason}`);
      } catch (error) {
        failTaskCommand(error, opts.json);
      }
    }
  );

claim
  .command("cleanup")
  .description("Clean up released or expired claims")
  .argument("[claim-token]", "Released or expired claim token to clean up")
  .option(
    "--expired <time-filter>",
    "Clean up expired terminal claims matching a time filter"
  )
  .option("--json", "Emit machine-readable JSON")
  .action(
    async (
      claimToken: string | undefined,
      opts: { expired?: string; json?: boolean }
    ) => {
      try {
        if (claimToken && opts.expired) {
          throw new TaskCommandError(
            "CLAIM_CLEANUP_INVALID_SELECTOR",
            "Use either a claim token or --expired, not both."
          );
        }
        if (!claimToken && !opts.expired) {
          throw new TaskCommandError(
            "CLAIM_CLEANUP_INVALID_SELECTOR",
            "Provide a claim token or --expired time filter."
          );
        }

        const commands = runtimeClaimCommands(claimLifecycleAuthorityRootDir());
        const result = opts.expired
          ? commands.cleanupExpiredClaims(parseTimeFilter(opts.expired!))
          : commands.cleanupClaim(claimToken!);
        emitRuntimeClaimCleanupResult(result, opts.json);
      } catch (error) {
        failTaskCommand(error, opts.json);
      }
    }
  );

function formatRuntimeLockStatusText(result: RuntimeLockStatusResult): string {
  if (result.state === "missing") {
    return `missing ${result.claimToken}`;
  }
  if (result.locks.length === 0) {
    return `${result.claimToken} ${result.state} (no locks)`;
  }
  return result.locks
    .map((lock) => `${lock.state} ${lock.path} ${lock.key}`)
    .join("\n");
}

function formatRuntimeLockAcquisitionConflictText(
  conflicts: RuntimeLockConflictDetail[]
): string {
  return conflicts
    .map(
      (conflict) =>
        `${conflict.path}: ${conflict.owner.claim_token} (${conflict.owner.target_id})`
    )
    .join("\n");
}

function formatRuntimeLockRemovalText(
  result: RuntimeLockRemovalResult
): string {
  if (result.outcome === "removed") {
    return result.removed.length > 0
      ? result.removed.map((lock) => `removed ${lock.path}`).join("\n")
      : `removed ${result.claimToken} (no locks)`;
  }
  return result.conflicts
    .map(
      (conflict) => `${conflict.reason} ${conflict.path} ${conflict.message}`
    )
    .join("\n");
}

function formatRuntimeClaimCleanupConflictText(
  conflicts: RuntimeClaimCleanupConflictDetail[]
): string {
  return conflicts
    .map(
      (conflict) =>
        `${conflict.reason} ${conflict.claim_token} ${conflict.message}`
    )
    .join("\n");
}

function formatRuntimeClaimCleanupText(
  result: RuntimeClaimCleanupResult
): string {
  if (result.outcome === "conflict") {
    return formatRuntimeClaimCleanupConflictText(result.conflicts);
  }
  return result.removed.length
    ? `removed ${result.removed.length} claim(s).`
    : "removed 0 claim(s).";
}

function emitRuntimeClaimCleanupResult(
  result: RuntimeClaimCleanupResult,
  json?: boolean
): void {
  if (json) {
    printTaskJson(result);
    if (result.outcome === "conflict") {
      process.exit(1);
    }
    return;
  }

  const text = formatRuntimeClaimCleanupText(result);
  if (result.outcome === "conflict") {
    console.error(text);
    process.exit(1);
  }
  console.log(text);
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
    "Validate backlog frontmatter against doc-vader work-management defaults"
  )
  .option(
    "--strict",
    "Promote semantic warnings unless consumer policy masks them"
  )
  .argument("[files...]", "Optional backlog markdown files to validate")
  .action(async (files: string[], opts: { strict?: boolean }) => {
    const args = [...(opts.strict ? ["--strict"] : []), ...(files ?? [])];
    const success = await validateWorkManagementFrontmatter(args);
    if (!success) {
      process.exit(1);
    }
  });

// --- DOMAIN: work items ---
function workItemIdFrom(command: Command): string {
  for (let current: Command | null = command; current; current = current.parent) {
    const value = (current.opts() as { workItemId?: string }).workItemId;
    if (value) return value;
  }
  throw new TaskCommandError("WORK_ITEM_ID_REQUIRED", "A Work Item id is required.");
}

function registerWorkCommandSurface(surface: Command): void {
  surface
    .command("list")
    .description("List open backlog work items")
    .option("--json", "Emit machine-readable JSON")
    .option("--porcelain", "Emit stable script-friendly work item lines")
    .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
    .action(async (opts: { json?: boolean; porcelain?: boolean; backlogDir?: string }) => {
      try {
        if (opts.json && opts.porcelain) {
          throw new TaskCommandError("TASK_LIST_FORMAT_CONFLICT", "Use either --json or --porcelain, not both.");
        }
        const tasks = (await listTaskModels({ backlogDir: opts.backlogDir })).sort((left, right) => left.id.localeCompare(right.id));
        if (opts.json) {
          printTaskJson({
            schemaVersion: "task-list/v1",
            tasks: tasks.map((task) => ({
              id: task.id, status: task.status, title: task.title, filePath: task.filePath, lifecycle: task.lifecycle,
              ...(task.statusReason ? { statusReason: task.statusReason } : {}), runtime: task.runtime,
            })),
          });
          return;
        }
        const output = opts.porcelain ? formatTaskListPorcelain(tasks) : formatTaskListText(tasks);
        if (output) console.log(output);
      } catch (error) { failTaskCommand(error, opts.json); }
    });

  surface
    .command("ready")
    .description("List fail-closed AFK-ready work item candidates")
    .option("--json", "Emit deterministic candidate and exclusion JSON")
    .option("--candidates-only", "Omit exclusions from JSON output")
    .option("--porcelain", "Emit stable script-friendly candidate lines")
    .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
    .action(async (opts: { json?: boolean; candidatesOnly?: boolean; porcelain?: boolean; backlogDir?: string }) => {
      try {
        if (opts.json && opts.porcelain) throw new TaskCommandError("TASK_READY_FORMAT_CONFLICT", "Use either --json or --porcelain, not both.");
        if (opts.candidatesOnly && !opts.json) throw new TaskCommandError("TASK_READY_CANDIDATES_ONLY_REQUIRES_JSON", "Use --candidates-only with --json.");
        assertWorkClaimAuthority(runtimeRootDir());
        const report = await selectReadyTasks({ backlogDir: opts.backlogDir });
        if (opts.json) {
          printTaskJson(opts.candidatesOnly ? { schemaVersion: report.schemaVersion, candidates: report.candidates } : report);
          return;
        }
        const output = opts.porcelain ? formatReadyPorcelain(report) : formatReadyText(report);
        if (output) console.log(output);
      } catch (error) { failTaskCommand(error, opts.json); }
    });

  const item = surface
    .command("resource", { hidden: true })
    .description("Operate on one Work Item resource")
    .requiredOption("--work-item-id <id>", "Canonical Work Item id");

  item
    .command("show")
    .description("Show canonical work item context")
    .option("--json", "Emit canonical work item JSON")
    .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
    .action(async (opts: { json?: boolean; backlogDir?: string }, command: Command) => {
      const taskId = workItemIdFrom(command);
      try {
        const result = await showWorkCommand({ taskId, backlogDir: opts.backlogDir });
        if (opts.json) printTaskJson(result); else console.log(await renderWorkShowCommand({ taskId, backlogDir: opts.backlogDir }));
      } catch (error) { failTaskCommand(error, opts.json); }
    });

  item
    .command("status")
    .description("Show operational work item status and recovery diagnostics")
    .option("--json", "Emit operational work item status JSON")
    .option("--worktree <path>", "Inspect status from a specific worktree")
    .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
    .action(async (opts: { json?: boolean; worktree?: string; backlogDir?: string }, command: Command) => {
      const taskId = workItemIdFrom(command);
      try {
        const result = await statusWorkCommand({ taskId, worktree: opts.worktree, backlogDir: opts.backlogDir });
        if (opts.json) printTaskJson(result); else console.log(formatTaskStatusText(result));
      } catch (error) { failTaskCommand(error, opts.json); }
    });

  item
    .command("update")
    .description("Apply a versioned structured Work Item update transaction")
    .option("--input <json|file>", "Inline JSON, JSON file, or stdin (-)")
    .option("--escalation <escalation-id>", "Bounded DV-native escalation for running checklist composition")
    .option("--claim <claim-token>", "Exact active claim token for claimed work")
    .option("--consumer-config <path>", "Path to consumer config JSON")
    .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
    .option("--dry-run", "Validate and render mutation without writing files")
    .option("--json", "Emit machine-readable JSON")
    .action(async (opts: { input?: string; escalation?: string; claim?: string; consumerConfig?: string; backlogDir?: string; dryRun?: boolean; json?: boolean }, command: Command) => {
      const taskId = workItemIdFrom(command);
      try {
        const result = await updateWorkFromInputCommand({ taskId, ...opts, stdin: process.stdin });
        if (opts.json) printTaskJson(result); else console.log("frontmatter" in result ? `${result.id} ${result.frontmatter.status} ${result.filePath}` : `${result.workItemId} ${result.filePath}`);
      } catch (error) { failTaskCommand(error, opts.json); }
    });

  item
    .command("prompt")
    .description("Render a Sandcastle-oriented prompt from canonical work item JSON")
    .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
    .action(async (opts: { backlogDir?: string }, command: Command) => {
      const taskId = workItemIdFrom(command);
      try { console.log(await promptWorkCommand({ taskId, backlogDir: opts.backlogDir })); }
      catch (error) { failTaskCommand(error); }
    });

  const itemClaim = item.command("claim").description("Create or release a Work Item claim");
  itemClaim
    .command("create", { isDefault: true })
    .description("Create a conservative local work item claim")
    .option("--json", "Emit machine-readable JSON")
    .option("--holder <holder>", "Claim holder identity")
    .option("--branch <branch>", "Branch or ref context")
    .option("--worktree <path>", "Worktree path")
    .option("--ttl-minutes <minutes>", "Claim time-to-live in minutes")
    .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
    .action(async (opts: { json?: boolean; holder?: string; branch?: string; worktree?: string; ttlMinutes?: string; backlogDir?: string }, command: Command) => {
      const taskId = workItemIdFrom(command);
      try {
        const result = await claimWorkCommand({ taskId, ...opts });
        if (opts.json) printTaskJson(result); else console.log(formatRuntimeClaimCreationText(result));
      } catch (error) { failTaskCommand(error, opts.json); }
    });

  itemClaim
    .command("release")
    .description("Release a claim with an explicit outcome")
    .requiredOption("--claim-token <claim-token>", "Claim token to release")
    .requiredOption("--outcome <outcome>", `Release outcome: ${CLAIM_RELEASE_OUTCOMES.join("|")}`)
    .option("--code <code>", "Structured detail code for non-success outcomes", "x-runtime-claim-released")
    .option("--message <message>", "Human-readable release detail")
    .option("--actual <hours>", "Actual effort in hours for successful close")
    .option("--json", "Emit machine-readable JSON")
    .option("--porcelain", "Emit stable script-friendly output for success")
    .option("--dry-run", "Validate and render success mutation without writing files")
    .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
    .option("--consumer-config <path>", "Path to consumer config JSON", ".doc-vader/backlog-consumer.json")
    .action(async (opts: { claimToken: string; outcome: string; code: string; message?: string; json?: boolean; porcelain?: boolean; dryRun?: boolean; backlogDir?: string; consumerConfig?: string; actual?: string }, command: Command) => {
      try {
        const model = await showWorkCommand({ taskId: workItemIdFrom(command) });
        const claim = runtimeClaimCommands(runtimeRootDir()).getClaimStatus(opts.claimToken);
        if (!claim || claim.target_type !== "task" || claim.target_id !== model.id) {
          throw new TaskCommandError("WORK_CLAIM_TARGET_MISMATCH", "Claim does not belong to the requested Work Item.");
        }
        const released = await releaseClaimCommand(opts.claimToken, opts);
        if (opts.json) printTaskJson(released.result);
        else if (released.outcome === "success") console.log(formatClaimCompletionText(released.result));
        else if (released.outcome === "failed") console.log(formatRuntimeExecutionTerminalText(released.result));
        else console.log(`${released.result.claimToken} released ${released.result.executionLogEntry.reason}`);
      } catch (error) { failTaskCommand(error, opts.json); }
    });

  item
    .command("recover")
    .description("Recover a halted work item and make it claimable again")
    .option("--holder <holder>", "Claim holder identity")
    .option("--branch <branch>", "Branch or ref context")
    .option("--worktree <path>", "Run recovery in a specific worktree")
    .option("--ttl-minutes <minutes>", "Claim time-to-live in minutes")
    .option("--force <mode>", recoveryForceHelp())
    .option("--dry-run", "Validate recovery without acquiring claims or writing files")
    .option("--json", "Emit machine-readable JSON")
    .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
    .action(async (opts: { holder?: string; branch?: string; worktree?: string; ttlMinutes?: string; force?: string; dryRun?: boolean; json?: boolean; backlogDir?: string }, command: Command) => {
      const taskId = workItemIdFrom(command);
      try {
        const result = await recoverWorkCommand({ taskId, ...opts });
        if (opts.json) printTaskJson(result); else console.log(formatRuntimeRecoveryText(result));
      } catch (error) { failTaskCommand(error, opts.json); }
    });

  item
    .command("repair-generated-evidence")
    .description("Claim-authorized repair for DV-generated evidence serialization defects")
    .requiredOption("--claim <claim-token>", "Active remediation claim")
    .requiredOption("--record <path>", "Evidence record Markdown path")
    .option("--dry-run", "Validate and preview without writing")
    .option("--json", "Emit machine-readable result")
    .action(async (opts: { claim: string; record: string; dryRun?: boolean; json?: boolean }, command: Command) => {
      const taskId = workItemIdFrom(command);
      try {
        const model = await showWorkCommand({ taskId });
        const result = await repairGeneratedEvidenceCommand({ claimToken: opts.claim, workItemPath: model.filePath, recordPath: opts.record, dryRun: opts.dryRun });
        if (opts.json) printTaskJson(result); else console.log(`${result.dryRun ? "preview" : "repaired"}: ${result.changed.join(", ")}`);
      } catch (error) { failTaskCommand(error, opts.json); }
    });

  item
    .command("record")
    .description("Create and link claim-scoped work item evidence")
    .requiredOption("--claim <claim-id>", "Active claim id")
    .requiredOption("--type <record-type>", "Record subtype, e.g. test-result")
    .requiredOption("--payload <json-file|->", "Record payload JSON file or stdin")
    .option("--json", "Emit machine-readable JSON")
    .option("--porcelain", "Emit stable script-friendly output")
    .option("--consumer-config <path>", "Path to consumer config JSON", ".doc-vader/backlog-consumer.json")
    .option("--dry-run", "Validate and render mutation without writing files")
    .action(async (opts: { claim: string; type: string; payload: string; json?: boolean; porcelain?: boolean; consumerConfig?: string; dryRun?: boolean }, command: Command) => {
      const taskId = workItemIdFrom(command);
      try {
        const model = await showWorkCommand({ taskId });
        const claim = runtimeClaimCommands(runtimeRootDir()).getClaimStatus(opts.claim);
        if (!claim || claim.target_type !== "task" || claim.target_id !== model.id) {
          throw new TaskCommandError("WORK_RECORD_TARGET_MISMATCH", "Claim does not belong to the requested Work Item.");
        }
        const result = await recordWorkCommand({ ...opts, payloadPath: opts.payload, stdin: process.stdin });
        if (opts.json) printTaskJson(result);
        else if (opts.porcelain) printTaskPorcelain([result.claimId, result.taskId, result.record.id, result.evidenceLink, result.record.filePath]);
        else console.log(`${result.taskId} ${result.evidenceLink}`);
      } catch (error) { failTaskCommand(error, opts.json); }
    });

  const checklist = item.command("checklist").description("Inspect pack-discovered Work Item checklists");
  checklist
    .option("--json", "Emit machine-readable checklist JSON")
    .option("--consumer-config <path>", "Path to consumer config JSON")
    .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
    .action(async (opts: { json?: boolean; consumerConfig?: string; backlogDir?: string }, command: Command) => {
      const taskId = workItemIdFrom(command);
      try {
        const result = await inspectWorkChecklistsCommand({ taskId, consumerConfig: opts.consumerConfig, backlogDir: opts.backlogDir });
        if (opts.json) printTaskJson(result); else console.log(JSON.stringify(result, null, 2));
      } catch (error) { failTaskCommand(error, opts.json); }
    });

  checklist
    .command("inspect", { hidden: true })
    .requiredOption("--checklist-id <id>", "Pack-discovered checklist id")
    .option("--json", "Emit machine-readable checklist JSON")
    .option("--consumer-config <path>", "Path to consumer config JSON")
    .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
    .action(async (opts: { checklistId: string; json?: boolean; consumerConfig?: string; backlogDir?: string }, command: Command) => {
      const taskId = workItemIdFrom(command);
      try {
        const result = await inspectWorkChecklistCommand({ taskId, checklistId: opts.checklistId, consumerConfig: opts.consumerConfig, backlogDir: opts.backlogDir });
        if (opts.json) printTaskJson(result); else console.log(JSON.stringify(result, null, 2));
      } catch (error) { failTaskCommand(error, opts.json); }
    });

  const check = checklist.command("check", { hidden: true })
    .requiredOption("--checklist-id <id>", "Pack-discovered checklist id")
    .requiredOption("--check-id <id>", "Current check id")
    .description("Operate on one current pack-discovered check");
  check
    .command("complete")
    .description("Complete one check, atomically creating or linking evidence")
    .requiredOption("--claim <claim-token>", "Exact active claim token")
    .requiredOption("--evidence <reference|json|->", "Evidence reference, raw JSON, or stdin")
    .option("--evidence-type <record-type>", "Record subtype for JSON evidence")
    .option("--consumer-config <path>", "Path to consumer config JSON")
    .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
    .option("--json", "Emit machine-readable JSON")
    .action(async (opts: { claim: string; evidence: string; evidenceType?: string; consumerConfig?: string; backlogDir?: string; json?: boolean }, command: Command) => {
      const checkOptions = command.parent!.opts() as { checklistId: string; checkId: string };
      const taskId = workItemIdFrom(command);
      try {
        const evidence = opts.evidence === "-" ? { stdin: await new Promise<string>((resolve, reject) => {
          let value = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => { value += chunk; }); process.stdin.on("end", () => resolve(value)); process.stdin.on("error", reject);
        }) } : opts.evidence;
        const result = await completeWorkChecklistCheckCommand({ taskId, checklistId: checkOptions.checklistId, checkId: checkOptions.checkId, claim: opts.claim, evidence, evidenceType: opts.evidenceType, consumerConfig: opts.consumerConfig, backlogDir: opts.backlogDir });
        if (opts.json) printTaskJson(result); else console.log(`${result.workItemId} completed ${checkOptions.checkId}`);
      } catch (error) { failTaskCommand(error, opts.json); }
    });

  check
    .command("clear")
    .description("Clear one check")
    .requiredOption("--claim <claim-token>", "Exact active claim token")
    .option("--consumer-config <path>", "Path to consumer config JSON")
    .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
    .option("--json", "Emit machine-readable JSON")
    .action(async (opts: { claim: string; consumerConfig?: string; backlogDir?: string; json?: boolean }, command: Command) => {
      const checkOptions = command.parent!.opts() as { checklistId: string; checkId: string };
      const taskId = workItemIdFrom(command);
      try {
        const result = await mutateWorkChecklistCheckCommand({ taskId, checklistId: checkOptions.checklistId, checkId: checkOptions.checkId, action: "clear", claim: opts.claim, consumerConfig: opts.consumerConfig, backlogDir: opts.backlogDir });
        if (opts.json) printTaskJson(result); else console.log(`${result.workItemId} cleared ${checkOptions.checkId}`);
      } catch (error) { failTaskCommand(error, opts.json); }
    });

}

const escalationCommand = program
  .command("escalation")
  .description("Bounded DV-native policy overrides");

escalationCommand
  .command("create")
  .requiredOption("--policy <policy-id>", "Registered DV-native escalation policy")
  .requiredOption("--payload <json|->", "Inline JSON, JSON file, or stdin (-)")
  .option("--json", "Emit machine-readable JSON")
  .action(async (opts: { policy: string; payload: string; json?: boolean }) => {
    try {
      const raw = opts.payload.trim().startsWith("{")
        ? opts.payload
        : opts.payload === "-"
          ? await new Promise<string>((resolve, reject) => {
              let value = "";
              process.stdin.setEncoding("utf8");
              process.stdin.on("data", (chunk) => { value += chunk; });
              process.stdin.on("end", () => resolve(value));
              process.stdin.on("error", reject);
            })
          : await fs.readFile(path.resolve(opts.payload), "utf8");
      const result = createEscalation({ policy: opts.policy, payload: JSON.parse(raw) });
      if (opts.json) printTaskJson(result); else console.log(result.id);
    } catch (error) { failTaskCommand(error, opts.json); }
  });

const escalationResource = escalationCommand
  .command("resource", { hidden: true })
  .requiredOption("--escalation-id <id>", "Canonical escalation id");

escalationResource
  .command("show")
  .option("--json", "Emit machine-readable JSON")
  .action((opts: { json?: boolean }, command: Command) => {
    try {
      const result = getEscalation({ escalationId: (command.parent!.opts() as { escalationId: string }).escalationId });
      if (opts.json) printTaskJson(result); else console.log(`${result.id} ${result.policy} uses=${result.uses}`);
    } catch (error) { failTaskCommand(error, opts.json); }
  });

const workCommand = program
  .command("work")
  .description("Work Item command surface");
registerWorkCommandSurface(workCommand);
workCommand.addHelpText("after", "\nCanonical resource commands: dv work <work-item-id> <operation>\n");

// --- DOMAIN: lock ---
const lock = program.command("lock").description("Runtime file lock commands");

lock
  .command("create")
  .description("Acquire claim-owned file locks")
  .requiredOption("--claim <claim-token>", "Active runtime claim token")
  .argument("<paths...>", "Paths to lock")
  .option("--json", "Emit machine-readable JSON")
  .action(
    async (
      paths: string[],
      opts: {
        claim: string;
        json?: boolean;
      }
    ) => {
      try {
        const result = runtimeClaimCommands(runtimeRootDir())
          .acquireLocks(opts.claim, paths);
        if (opts.json) {
          printTaskJson(result);
          if (result.outcome === "conflict") {
            process.exit(1);
          }
        } else if (result.outcome === "acquired") {
          console.log(
            result.locks
              .map((lockRecord) => `locked ${lockRecord.path}`)
              .join("\n")
          );
        } else {
          console.error(
            formatRuntimeLockAcquisitionConflictText(result.conflicts)
          );
          process.exit(1);
        }
      } catch (error) {
        failTaskCommand(error, opts.json);
      }
    }
  );

lock
  .command("rm")
  .description("Release claim-owned file locks")
  .requiredOption("--claim <claim-token>", "Active runtime claim token")
  .argument("<paths...>", "Paths to unlock")
  .option("--json", "Emit machine-readable JSON")
  .action(
    async (
      paths: string[],
      opts: {
        claim: string;
        json?: boolean;
      }
    ) => {
      try {
        const result = runtimeClaimCommands(runtimeRootDir())
          .removeLocks(opts.claim, paths);
        if (opts.json) {
          printTaskJson(result);
          if (result.outcome === "conflict") {
            process.exit(1);
          }
        } else if (result.outcome === "removed") {
          console.log(
            result.removed
              .map((lockRecord) => `released ${lockRecord.path}`)
              .join("\n")
          );
        } else {
          console.error(formatRuntimeLockRemovalText(result));
          process.exit(1);
        }
      } catch (error) {
        failTaskCommand(error, opts.json);
      }
    }
  );

lock
  .command("status")
  .description("Show the current locks for a claim")
  .requiredOption("--claim <claim-token>", "Active runtime claim token")
  .option("--json", "Emit machine-readable JSON")
  .action(async (opts: { claim: string; json?: boolean }) => {
    try {
      const result = runtimeClaimCommands(runtimeRootDir())
        .getLockStatus(opts.claim);
      if (opts.json) {
        printTaskJson(result);
      } else {
        console.log(formatRuntimeLockStatusText(result));
      }
    } catch (error) {
      failTaskCommand(error, opts.json);
    }
  });

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
    ".doc-vader/backlog-consumer.json"
  )
  .option(
    "--fail-on <level>",
    "Fail level for exit code: error|warning",
    "error"
  )
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
    []
  )
  .option(
    "--schema-map <path>",
    "Optional schema-map JSON path for schema routing"
  )
  .option(
    "--include-archive",
    "Include backlog/archive files in audit validation",
    false
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
  .command("review")
  .description("Run the deterministic backlog review profile")
  .option("-d, --dir <path>", "Path to the backlog directory", "backlog")
  .option("--json", "Emit machine-readable JSON")
  .action(async (opts: { dir: string; json?: boolean }) => {
    try {
      const report = await runBacklogReview({ backlogDir: opts.dir });
      if (opts.json) {
        console.log(formatBacklogReviewReportJson(report));
      } else {
        console.log(formatBacklogReviewReportText(report));
      }
    } catch (error) {
      failTaskCommand(error, opts.json);
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
    "Migrate a legacy backlog to canonical doc-vader work-management artifacts"
  )
  .option("-d, --dir <path>", "Path to the legacy backlog directory")
  .option("--consumer-config <path>", "Path to consumer config JSON")
  .option("--claim <claim-token>", "Exact active Claim token for a claimed migrated Work Item")
  .option("--dry-run", "Show what would change without writing files")
  .option("--write", "Apply the migration")
  .action(async (opts) => {
    if (opts.write && opts.dryRun) {
      throw new Error("Use either --write or --dry-run, not both.");
    }
    const result = await migrateBacklogWorkManagement({
      dir: opts.dir,
      consumerConfig: opts.consumerConfig,
      claimToken: opts.claim,
      dryRun: opts.write ? false : Boolean(opts.dryRun ?? true),
    });
    console.log(JSON.stringify(result, null, 2));
  });

backlog
  .command("ingest-event")
  .description("Ingest a forge/VCS event payload and apply backlog mutations")
  .requiredOption(
    "--provider <provider>",
    "Provider: github|gitlab|bitbucket|subversion"
  )
  .requiredOption("--event <event>", "Event name, e.g. pull_request.closed")
  .requiredOption("--payload <path>", "Path to JSON payload file")
  .option("--consumer-config <path>", "Path to consumer config JSON")
  .option("--claim <claim-token>", "Exact active Claim token for claimed event subjects")
  .option("--dry-run", "Show the mutations without writing files")
  .action(async (opts) => {
    const result = await ingestBacklogEvent({
      provider: opts.provider,
      event: opts.event,
      payloadPath: opts.payload,
      consumerConfig: opts.consumerConfig,
      claimToken: opts.claim,
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
      .default("text")
  )
  .option("--output-file <path>", "Write report to file instead of stdout")
  .option(
    "--consumer-config <path>",
    "Path to consumer config JSON",
    ".doc-vader/backlog-consumer.json"
  )
  .option(
    "--resolver-order <order>",
    `Comma-separated resolver order (${DEFAULT_RESOLVER_ORDER.join(",")})`
  )
  .option(
    "--generate-evidence",
    "Create and link evidence records for resolved work items",
    false
  )
  .option(
    "--validate-archive-candidates",
    "Validate ready-for-review/closed candidates and archive eligible work items",
    false
  )
  .option(
    "--invalid-candidate-status <status>",
    "Optional status to set on invalid candidates (use 'none' to disable updates)"
  )
  .option("--claim <claim-token>", "Exact active claim token for one candidate archive mutation")
  .option("--dry-run", "Preview changes without writing files", false)
  .option("--strict", "Exit 1 if any errors are found", false)
  .option("--debug", "Enable verbose debug output", false)
  .action(async (opts) => {
    if (opts.reportFormat !== "text" && opts.reportFormat !== "json") {
      throw new Error(
        `Invalid --report-format value: ${opts.reportFormat}. Expected text or json.`
      );
    }

    const resolverOrder =
      typeof opts.resolverOrder === "string"
        ? (opts.resolverOrder
            .split(",")
            .map((value: string) => value.trim())
            .filter(
              (value: string) => value.length > 0
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
      claimToken: opts.claim,
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


const record = program
  .command("record")
  .description("Canonical record creation commands");

record
  .command("create")
  .description("Create an append-only record artifact from a validated payload")
  .requiredOption("--type <record-type>", "Record subtype, e.g. test-result")
  .requiredOption(
    "--payload <json-file|->",
    "Record payload JSON file or stdin"
  )
  .option("--json", "Emit machine-readable JSON")
  .option("--porcelain", "Emit stable script-friendly output")
  .option("--consumer-config <path>", "Path to consumer config JSON")
  .option("--claim <claim-token>", "Exact active Claim token for claimed Work subjects")
  .option("--dry-run", "Show the mutation without writing files")
  .action(
    async (opts: {
      type: string;
      payload: string;
      json?: boolean;
      porcelain?: boolean;
      consumerConfig?: string;
      claim?: string;
      dryRun?: boolean;
    }) => {
      try {
        if (opts.json && opts.porcelain) {
          throw new Error("Use either --json or --porcelain, not both.");
        }
        const payload = await readRecordPayload(opts.payload, process.stdin);
        const result = await createWorkRecord({
          id: payload.id,
          summary: payload.summary,
          observation: payload.observation,
          subjects:
            payload.subjects ?? (payload.subject ? [payload.subject] : []),
          subtype: opts.type,
          outcome: payload.outcome,
          recordedAt: payload.recordedAt,
          artifactRefs: payload.artifactRefs,
          supportingRefs: payload.supportingRefs,
          findings: payload.findings,
          notes: payload.notes,
          consumerConfig: opts.consumerConfig,
          claimToken: opts.claim,
          dryRun: opts.dryRun,
        });
        if (opts.json) {
          printTaskJson(result);
          return;
        }
        if (opts.porcelain) {
          printTaskPorcelain([
            result.id,
            result.filePath,
            result.dryRun ? "dry-run" : "written",
          ]);
          return;
        }
        console.log(formatRecordCreationText(result));
      } catch (error) {
        failTaskCommand(error, opts.json);
      }
    }
  );

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
      .default("text")
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
          2
        )
      );
    }
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
    "Reconcile conflicts between selected governance profiles using deterministic priority-order strategy"
  )
  .argument("<file>", "Markdown file path")
  .option(
    "--strategy <strategy>",
    "priority-order|prioritize|auto|deterministic",
    "priority-order"
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

// --- DOMAIN: extensions ---
const extensions = program
  .command("extensions")
  .description("Manage Doc-Vader CLI extensions installed under .doc-vader/extensions");

extensions
  .command("list")
  .description("List installed Doc-Vader CLI extensions")
  .option("--json", "Emit machine-readable JSON")
  .action(async (opts: { json?: boolean }) => {
    const installedExtensions = await listInstalledExtensions();
    if (opts.json) {
      console.log(JSON.stringify({ extensions: installedExtensions }, null, 2));
      return;
    }
    if (installedExtensions.length === 0) {
      console.log("No Doc-Vader extensions installed.");
      return;
    }
    for (const extension of installedExtensions) {
      console.log(
        `${extension.enabled ? "enabled" : "disabled"}\t${extension.name}\t${extension.packageSpecifier}`,
      );
    }
  });

extensions
  .command("install")
  .description("Install/register a Doc-Vader CLI extension in .doc-vader/extensions")
  .argument("<specifier>", "Node package name or local package directory")
  .option("--name <name>", "Stable local extension name")
  .option("--no-validate", "Record the extension without importing it first")
  .option("--json", "Emit machine-readable JSON")
  .action(
    async (
      specifier: string,
      opts: { name?: string; validate?: boolean; json?: boolean },
    ) => {
      const extension = await installDocVaderExtension(specifier, {
        name: opts.name,
        validate: opts.validate,
      });
      if (opts.json) {
        console.log(JSON.stringify({ extension }, null, 2));
        return;
      }
      console.log(`installed ${extension.name} -> ${extension.packageSpecifier}`);
    },
  );

extensions
  .command("uninstall")
  .alias("remove")
  .description("Uninstall/unregister a Doc-Vader CLI extension")
  .argument("<name-or-specifier>", "Installed extension name or specifier")
  .option("--json", "Emit machine-readable JSON")
  .action(async (nameOrSpecifier: string, opts: { json?: boolean }) => {
    const extension = await uninstallDocVaderExtension(nameOrSpecifier);
    if (opts.json) {
      console.log(JSON.stringify({ extension: extension ?? null }, null, 2));
      return;
    }
    if (!extension) {
      console.log(`No Doc-Vader extension matched ${nameOrSpecifier}.`);
      return;
    }
    console.log(`uninstalled ${extension.name}`);
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

function normalizeWorkResourceArguments(argv: string[]): void {
  if (argv[2] === "work" && argv[3] === "resource") {
    throw new TaskCommandError("WORK_COMMAND_LEGACY_ROUTE", "Use 'dv work <work-item-id> <operation>'.");
  }
  if (argv[2] !== "work" || argv[3] === "list" || argv[3] === "ready" || !argv[3]) return;
  const [workItemId, operation] = [argv[3], argv[4]];
  const operations = new Set(["show", "status", "update", "prompt", "claim", "recover", "repair-generated-evidence", "record", "checklist"]);
  if (!operations.has(operation ?? "") && operation !== "--help") return;
  if (operation === "claim" && argv[6] === "release") {
    argv.splice(3, 4, "resource", "--work-item-id", workItemId!, "claim", "release", "--claim-token", argv[5]!);
    return;
  }
  if (operation === "checklist" && argv[6] === "check" && (argv[8] === "complete" || argv[8] === "clear")) {
    argv.splice(3, 6, "resource", "--work-item-id", workItemId!, "checklist", "check", "--checklist-id", argv[5]!, "--check-id", argv[7]!, argv[8]!);
    return;
  }
  if (operation === "checklist" && argv[5] && !argv[5]!.startsWith("-")) {
    argv.splice(3, 3, "resource", "--work-item-id", workItemId!, "checklist", "inspect", "--checklist-id", argv[5]!);
    return;
  }
  argv.splice(3, 1, "resource", "--work-item-id", workItemId!);
}

normalizeWorkResourceArguments(process.argv);
if (process.argv[2] === "escalation" && process.argv[3] && !["create", "resource", "help", "--help"].includes(process.argv[3]) && process.argv[4] === "show") {
  process.argv.splice(3, 1, "resource", "--escalation-id", process.argv[3]!);
}
if (process.argv[2] !== "extensions") {
  await registerConfiguredExtensions(program);
}
program.parse(process.argv);
