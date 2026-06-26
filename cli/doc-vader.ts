#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Command, Option } from "commander";
import path from "node:path";
import {
  openRuntimeSqliteStore,
  getRuntimeClaimDefaultTtlMilliseconds,
  type RuntimeChangedFileAuditResult,
  type RuntimeClaimCleanupConflictDetail,
  type RuntimeClaimCleanupResult,
  type RuntimeClaimRecord,
  type RuntimeExecutionHaltDetail,
  type RuntimeExecutionHaltedReason,
  type RuntimeExecutionTerminalResult,
  type RuntimeLockConflictDetail,
  type RuntimeLockRemovalResult,
  type RuntimeLockRecord,
  type RuntimeLockStatusResult,
  type RuntimeSqliteStore,
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
} from "../lib/controllers/workManagementController.js";
import {
  validate as validatePrdPayload,
  render as renderPrd,
} from "../lib/controllers/prdController.js";
import { validateFrontmatter as validateWorkManagementFrontmatter } from "../lib/work-management/frontmatter-lint.js";
import { main as runStatusReasonCompatibility } from "../lib/work-management/status-reason-compatibility.js";
import {
  claimWork as claimTask,
  completeWorkClaim as completeTaskClaim,
  assertWorkClaimable as assertTaskClaimable,
  createWorkGraphOutputExtension,
  inspectWorkGraphNode,
  loadCanonicalWork as loadCanonicalTask,
  loadWorkModel as loadTaskModel,
  listWorkModels as listTaskModels,
  projectWorkGraph,
  queryWorkGraphEdges,
  queryWorkGraphNodes,
  readWorkRecordPayload as readRecordPayload,
  recoverWorkClaim as recoverTaskClaim,
  recordWorkEvidence as recordTaskEvidence,
  renderHumanWork as renderHumanTask,
  renderSandcastleWorkPrompt as renderSandcastlePrompt,
  formatReadyPorcelain,
  formatReadyText,
  selectReadyWorkItems as selectReadyTasks,
  resolveWorkRoot as resolveGitRoot,
  resolveWorkAuthority as resolveTaskAuthority,
  collectWorkRecoveryGitState as collectTaskRecoveryGitState,
  isRecoverableReadyRuntimeState,
  type WorkRecoveryForceMode as TaskRecoveryForceMode,
  type WorkModel as TaskModel,
  type WorkRecoveryGitState as TaskRecoveryGitState,
  type WorkGraphEdgeType,
  type WorkGraphExplorerResult,
  type WorkGraphExplorerFormat,
  type WorkGraphNodeType,
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

function parseRecoveryForceMode(
  value: string | undefined
): TaskRecoveryForceMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  switch (value) {
    case "reset":
      return "reset";
    case "reconcile":
      return "reconcile";
    default:
      throw new TaskCommandError(
        "TASK_RECOVERY_INVALID_FORCE_MODE",
        "Force mode must be reset or reconcile.",
        { force: value }
      );
  }
}

function recoveryForceHelp(): string {
  return [
    "Resolve dirty paths during recovery.",
    "reset discards recoverable dirty paths.",
    "reconcile saves a checkpoint before discarding recoverable dirty paths.",
  ].join(" ");
}

function parseTaskNumber(
  value: string | undefined,
  optionName: string
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TaskCommandError(
      "TASK_INVALID_NUMBER",
      `${optionName} must be a finite number.`,
      { optionName, value }
    );
  }
  return parsed;
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
] as const satisfies readonly WorkGraphEdgeType[];

const WORK_GRAPH_FORMATS = [
  "json",
  "dot",
] as const satisfies readonly WorkGraphExplorerFormat[];

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

function createWorkGraphFormatOption(): Option {
  return new Option("--format <format>", "Output format")
    .choices([...WORK_GRAPH_FORMATS])
    .default("json");
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

function runtimeRootDir(): string {
  return resolveGitRoot(process.cwd());
}

function runtimeStorePath(rootDir: string): string {
  return path.resolve(rootDir, ".doc-vader", "runtime", "runtime.sqlite");
}

function claimExecutionStore(rootDir: string): RuntimeSqliteStore {
  return openRuntimeSqliteStore({
    rootDir,
    databasePath: runtimeStorePath(rootDir),
  });
}

const HALTING_REASONS = [
  "conflict",
  "blocked",
  "invalid",
  "expired",
  "revoked",
  "cancelled",
] as const satisfies readonly RuntimeExecutionHaltedReason[];

const HALTING_REASON_SET = new Set<string>(HALTING_REASONS);

function isHaltingReason(value: string): value is RuntimeExecutionHaltedReason {
  return HALTING_REASON_SET.has(value);
}

const CLAIM_RELEASE_OUTCOMES = [
  "success",
  "failed",
  ...HALTING_REASONS,
] as const;

type ClaimReleaseOutcome = (typeof CLAIM_RELEASE_OUTCOMES)[number];

const CLAIM_RELEASE_OUTCOME_SET = new Set<string>(CLAIM_RELEASE_OUTCOMES);

function parseClaimReleaseOutcome(value: string): ClaimReleaseOutcome {
  if (CLAIM_RELEASE_OUTCOME_SET.has(value)) {
    return value as ClaimReleaseOutcome;
  }
  throw new TaskCommandError(
    "CLAIM_INVALID_OUTCOME",
    `Claim release outcome must be one of ${CLAIM_RELEASE_OUTCOMES.join(
      ", "
    )}.`,
    { outcome: value }
  );
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
  if (targetType !== "task") {
    throw new TaskCommandError(
      "CLAIM_INVALID_TARGET",
      "Only task targets are supported in the MVP.",
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

interface TaskStatusReport {
  schemaVersion: "task-status/v1";
  id: string;
  title: string;
  filePath: string;
  status: string;
  statusReason?: string;
  lifecycle: string;
  validation: TaskModel["validation"];
  runtime?: TaskModel["runtime"];
  recovery: {
    state:
      | "ready"
      | "not-needed"
      | "recoverable"
      | "force-required"
      | "blocked"
      | "not-recoverable";
    forceRequired: boolean;
    forceReasons: string[];
    blockedReasons: string[];
    warnings: string[];
    gitState: TaskRecoveryGitState;
    forceModes?: {
      reset: string;
      reconcile: string;
    };
    recommendation?: string;
  };
}

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

function taskNumberFromId(taskId: string): string {
  return taskId.replace(/^wi-/, "");
}

function gitWorktreePathForBranch(
  rootDir: string,
  branchName: string
): string | undefined {
  let output: string;
  try {
    output = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }

  const matches: string[] = [];
  let currentPath: string | undefined;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length);
      continue;
    }
    if (currentPath && line === `branch refs/heads/${branchName}`) {
      matches.push(currentPath);
    }
  }

  return matches.length === 1 ? path.resolve(matches[0]!) : undefined;
}

function resolveTaskStatusWorktree(
  task: TaskModel,
  rootDir: string
): string | undefined {
  const branchCandidates = [
    task.runtime?.latestExecutionLog?.branch,
    `sandcastle/issue-${taskNumberFromId(task.id)}`,
  ].filter((value): value is string => Boolean(value));
  const uniqueBranches = [...new Set(branchCandidates)];

  const worktrees = uniqueBranches
    .map((branch) => gitWorktreePathForBranch(rootDir, branch))
    .filter((value): value is string => Boolean(value));
  const uniqueWorktrees = [...new Set(worktrees)];
  return uniqueWorktrees.length === 1 ? uniqueWorktrees[0] : undefined;
}

function buildTaskStatusReport(
  task: TaskModel,
  options: {
    rootDir?: string;
    worktree?: string;
  } = {}
): TaskStatusReport {
  const rootDir = path.resolve(
    options.rootDir ?? options.worktree ?? process.cwd()
  );
  const gitState = collectTaskRecoveryGitState({
    rootDir,
    taskFilePath: task.filePath,
    expectedBranch: task.runtime?.latestExecutionLog?.branch,
    expectedWorktree:
      options.worktree ?? task.runtime?.latestExecutionLog?.worktree,
  });
  const recoverable = isRecoverableReadyRuntimeState({
    status: task.status,
    runtime: task.runtime,
    gitState,
  });
  const recoverableWithForce = isRecoverableReadyRuntimeState({
    status: task.status,
    runtime: task.runtime,
    gitState,
    allowUncertainLineage: true,
  });
  const blockedReasons = [
    ...gitState.resumeBlockedReasons,
    ...(task.runtime?.latestExecutionLog?.claimState === "active"
      ? ["claim-active"]
      : []),
    ...((task.runtime?.latestExecutionLog?.lockCount ?? 0) > 0
      ? ["locks-active"]
      : []),
  ];
  const forceReasons =
    !recoverable && recoverableWithForce ? [...gitState.resumeWarnings] : [];
  const state: TaskStatusReport["recovery"]["state"] = task.runtime?.ready
    ? "ready"
    : !task.runtime?.latestExecutionLog
    ? "not-needed"
    : recoverable
    ? "recoverable"
    : recoverableWithForce
    ? "force-required"
    : blockedReasons.length > 0
    ? "blocked"
    : "not-recoverable";

  return {
    schemaVersion: "task-status/v1",
    id: task.id,
    title: task.title,
    filePath: task.filePath,
    status: task.status,
    ...(task.statusReason ? { statusReason: task.statusReason } : {}),
    lifecycle: task.lifecycle,
    validation: task.validation,
    ...(task.runtime ? { runtime: task.runtime } : {}),
    recovery: {
      state,
      forceRequired: state === "force-required",
      forceReasons,
      blockedReasons,
      warnings: gitState.resumeWarnings,
      gitState,
      ...(state === "force-required"
        ? {
            forceModes: {
              reset:
                "Discard recoverable dirty paths before marking the task ready again.",
              reconcile:
                "Save a recovery checkpoint before discarding recoverable dirty paths.",
            },
            recommendation:
              "Inspect the current branch and dirty paths first. Pass --worktree when you can identify the intended recovery checkout. Use --force reset only when this checkout is the intended task branch and task-local dirty paths can be discarded; use --force reconcile when you want a checkpoint first.",
          }
        : {}),
    },
  };
}

function isRecoveryActionable(
  state: TaskStatusReport["recovery"]["state"]
): boolean {
  return state === "recoverable" || state === "force-required";
}

async function resolveTaskRecoveryRootDir(
  taskId: string,
  options: {
    worktree?: string;
    backlogDir?: string;
  } = {}
): Promise<string | undefined> {
  if (options.worktree) {
    return path.resolve(options.worktree);
  }

  const commandRootDir = process.cwd();
  const currentModel = await loadTaskModel(taskId, {
    rootDir: commandRootDir,
    backlogDir: options.backlogDir,
  });
  const currentReport = buildTaskStatusReport(currentModel, {
    rootDir: commandRootDir,
  });
  if (isRecoveryActionable(currentReport.recovery.state)) {
    return undefined;
  }

  const resolvedWorktree = resolveTaskStatusWorktree(
    currentModel,
    commandRootDir
  );
  if (!resolvedWorktree || path.resolve(resolvedWorktree) === commandRootDir) {
    return undefined;
  }

  const worktreeModel = await loadTaskModel(taskId, {
    rootDir: resolvedWorktree,
    backlogDir: options.backlogDir,
  });
  const worktreeReport = buildTaskStatusReport(worktreeModel, {
    rootDir: resolvedWorktree,
    worktree: resolvedWorktree,
  });

  return isRecoveryActionable(worktreeReport.recovery.state)
    ? resolvedWorktree
    : undefined;
}

async function recoverTaskIfSafelyRecoverable(
  task: TaskModel,
  options: {
    holder?: string;
    branch?: string;
    worktree?: string;
    ttlMinutes?: number;
    backlogDir?: string;
  } = {}
): Promise<TaskModel> {
  if (task.runtime?.ready !== false) {
    return task;
  }

  const latestExecutionLog = task.runtime.latestExecutionLog;
  if (
    latestExecutionLog?.state !== "running" ||
    latestExecutionLog.reason !== "started" ||
    latestExecutionLog.claimState === "active" ||
    (latestExecutionLog.lockCount ?? 0) !== 0
  ) {
    return task;
  }

  const rootDir = path.resolve(options.worktree ?? process.cwd());
  const recoveryOptions = {
    rootDir,
    taskId: task.id,
    backlogDir: options.backlogDir,
    holder: options.holder,
    branch: options.branch,
    worktree: options.worktree ?? rootDir,
    ttlMinutes: options.ttlMinutes,
  };
  try {
    await recoverTaskClaim({
      ...recoveryOptions,
      dryRun: true,
    });
  } catch {
    return task;
  }

  await recoverTaskClaim(recoveryOptions);

  return loadTaskModel(task.id, {
    rootDir,
    backlogDir: options.backlogDir,
  });
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function formatTaskStatusText(report: TaskStatusReport): string {
  const latest = report.runtime?.latestExecutionLog;
  const lines = [
    `${report.id} | ${report.status} | ${report.title}`,
    `Path: ${report.filePath}`,
    "",
    "Readiness",
    `- markdown: ${report.runtime?.markdownReady ? "ready" : "not ready"}`,
    `- execution: ${report.runtime?.executionReady ? "ready" : "not ready"}`,
    `- effective: ${report.runtime?.ready ? "ready" : "not ready"}`,
    `- source disagreement: ${yesNo(
      report.runtime?.sourceDisagreement ?? false
    )}`,
  ];
  if (latest) {
    lines.push(
      `- latest execution: ${latest.state}/${latest.reason} claim=${
        latest.claimState ?? "unknown"
      } locks=${latest.lockCount ?? "unknown"}`
    );
  }
  lines.push(
    "",
    "Recovery",
    `- state: ${report.recovery.state}`,
    `- force required: ${yesNo(report.recovery.forceRequired)}`
  );
  if (report.recovery.forceReasons.length > 0) {
    lines.push(`- force reasons: ${report.recovery.forceReasons.join(", ")}`);
  }
  if (report.recovery.blockedReasons.length > 0) {
    lines.push(
      `- blocked reasons: ${report.recovery.blockedReasons.join(", ")}`
    );
  }
  if (report.recovery.recommendation) {
    lines.push(`- recommendation: ${report.recovery.recommendation}`);
  }
  lines.push(
    "",
    "Git",
    `- current branch: ${report.recovery.gitState.currentBranch ?? "unknown"}`,
    `- expected branch: ${
      report.recovery.gitState.expectedBranch ?? "unknown"
    }`,
    `- current worktree: ${report.recovery.gitState.currentWorktree}`,
    `- expected worktree: ${
      report.recovery.gitState.expectedWorktree ?? "unknown"
    }`,
    `- lineage known: ${yesNo(report.recovery.gitState.lineageKnown)}`,
    `- branch lineage known: ${yesNo(
      report.recovery.gitState.branchLineageKnown
    )}`,
    `- worktree lineage known: ${yesNo(
      report.recovery.gitState.worktreeLineageKnown
    )}`,
    `- merge/rebase in progress: ${yesNo(
      report.recovery.gitState.mergeInProgress ||
        report.recovery.gitState.rebaseInProgress
    )}`,
    `- dirty paths: ${report.recovery.gitState.dirtyPaths.length}`,
    `- task path dirty: ${yesNo(report.recovery.gitState.taskPathDirty)}`
  );
  return lines.join("\n");
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

function formatTaskRecordPorcelain(result: {
  claimId: string;
  taskId: string;
  record: { id: string; filePath: string; dryRun: boolean };
  evidenceLink: string;
}): string {
  return [
    result.claimId,
    result.taskId,
    result.record.id,
    result.record.filePath,
    result.evidenceLink,
    result.record.dryRun ? "dry-run" : "written",
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

function formatClaimCompletionPorcelain(result: {
  claimId: string;
  taskId: string;
  dryRun: boolean;
}): string {
  return [
    result.claimId,
    result.taskId,
    result.dryRun ? "dry-run" : "completed",
  ].join("\t");
}

async function runClaimSuccessRelease(
  claimToken: string,
  opts: {
    json?: boolean;
    porcelain?: boolean;
    dryRun?: boolean;
    backlogDir?: string;
    consumerConfig?: string;
  }
): Promise<void> {
  if (opts.json && opts.porcelain) {
    throw new Error("Use either --json or --porcelain, not both.");
  }
  const result = await completeTaskClaim({
    claimId: claimToken,
    rootDir: runtimeRootDir(),
    backlogDir: opts.backlogDir,
    consumerConfig: opts.consumerConfig,
    dryRun: opts.dryRun,
  });
  if (opts.json) {
    printTaskJson(result);
    return;
  }
  if (opts.porcelain) {
    printTaskPorcelain([
      result.claimId,
      result.taskId,
      result.dryRun ? "dry-run" : "released",
    ]);
    return;
  }
  console.log(formatClaimCompletionText(result));
}

function runClaimFailedRelease(
  claimToken: string,
  opts: { json?: boolean }
): void {
  const store = claimExecutionStore(runtimeRootDir());
  try {
    const result = store.failRuntimeExecution(claimToken);
    if (opts.json) {
      printTaskJson(result);
      return;
    }
    console.log(formatRuntimeExecutionTerminalText(result));
  } finally {
    store.close();
  }
}

async function runClaimHaltedRelease(
  claimToken: string,
  opts: {
    reason: RuntimeExecutionHaltedReason;
    code: string;
    message?: string;
    json?: boolean;
  }
): Promise<void> {
  const rootDir = runtimeRootDir();
  const store = claimExecutionStore(rootDir);
  try {
    const audit = store.auditChangedFiles(claimToken, {});
    const halted = haltClaimExecution(store, claimToken, {
      reason: opts.reason,
      code: opts.code,
      message: opts.message,
      dirtyPaths: audit.changedPaths,
      unlockedPaths: audit.diagnostics
        .filter((diagnostic) => diagnostic.actualLockState !== "owned")
        .map((diagnostic) => diagnostic.path),
      audit,
    });

    if (
      opts.reason === "conflict" &&
      opts.code === "lock" &&
      halted.claim.target_type === "task"
    ) {
      try {
        await transitionWorkItem({
          id: halted.claim.target_id,
          status: "paused",
          statusReason: "system",
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
      }
    }

    if (opts.json) {
      printTaskJson(halted);
      return;
    }
    console.log(
      `${halted.claimToken} released ${halted.executionLogEntry.reason}`
    );
  } finally {
    store.close();
  }
}

async function runTaskRecoveryCommand(
  taskId: string,
  opts: {
    holder?: string;
    branch?: string;
    worktree?: string;
    ttlMinutes?: string;
    force?: string;
    dryRun?: boolean;
    json?: boolean;
    backlogDir?: string;
  }
): Promise<void> {
  const ttlMinutes = parseOptionalFiniteMinutes(opts.ttlMinutes);
  const force = parseRecoveryForceMode(opts.force);
  const rootDir = await resolveTaskRecoveryRootDir(taskId, {
    worktree: opts.worktree,
    backlogDir: opts.backlogDir,
  });
  const result = await recoverTaskClaim({
    rootDir,
    taskId,
    backlogDir: opts.backlogDir,
    holder: opts.holder,
    branch: opts.branch,
    worktree: opts.worktree ?? rootDir,
    ttlMinutes,
    force,
    dryRun: opts.dryRun,
  });
  if (opts.json) {
    printTaskJson(result);
    return;
  }
  console.log(formatRuntimeRecoveryText(result));
}

function formatRuntimeClaimCreationText(
  result: ReturnType<RuntimeSqliteStore["acquireRuntimeClaim"]>
): string {
  return `${result.claimToken} ${result.executionLogEntry.state} ${result.executionLogEntry.reason}`;
}

function createRuntimeClaim(
  target: { targetType: string; targetId: string },
  opts: {
    rootDir?: string;
    holder?: string;
    branch?: string;
    worktree?: string;
    ttlMinutes?: number;
  }
): ReturnType<RuntimeSqliteStore["acquireRuntimeClaim"]> {
  const store = claimExecutionStore(resolveGitRoot(opts.rootDir));
  try {
    const now = new Date();
    const ttlMilliseconds =
      opts.ttlMinutes === undefined
        ? getRuntimeClaimDefaultTtlMilliseconds()
        : opts.ttlMinutes * 60_000;
    return store.acquireRuntimeClaim({
      schema_version: "runtime-entity/v1",
      target_type: target.targetType,
      target_id: target.targetId,
      holder: opts.holder?.trim() || "local-agent",
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttlMilliseconds).toISOString(),
      ...(opts.branch || opts.worktree
        ? {
            metadata: {
              ...(opts.branch ? { branch: opts.branch } : {}),
              ...(opts.worktree ? { worktree: opts.worktree } : {}),
            },
          }
        : {}),
      entropy: randomUUID(),
    });
  } finally {
    store.close();
  }
}

function collectChangedPaths(rootDir: string): string[] {
  try {
    const output = execFileSync("git", ["status", "--porcelain=v1", "-uall"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!output) {
      return [];
    }
    const paths = new Set<string>();
    for (const line of output.split("\n")) {
      const entry = line.trimEnd();
      if (!entry) {
        continue;
      }
      const rawPath = entry.slice(3).trim();
      const pathValue = rawPath.includes(" -> ")
        ? rawPath.split(" -> ").pop() ?? ""
        : rawPath;
      if (!pathValue) {
        continue;
      }
      paths.add(pathValue);
    }
    return [...paths].sort();
  } catch {
    return [];
  }
}

function buildHaltDetail(options: {
  code: string;
  message?: string;
  dirtyPaths?: string[];
  unlockedPaths?: string[];
  audit?: RuntimeChangedFileAuditResult;
}): RuntimeExecutionHaltDetail {
  return {
    code: options.code,
    ...(options.message ? { message: options.message } : {}),
    ...(options.dirtyPaths && options.dirtyPaths.length > 0
      ? { "x-dirty-paths": options.dirtyPaths }
      : {}),
    ...(options.unlockedPaths && options.unlockedPaths.length > 0
      ? { "x-unlocked-paths": options.unlockedPaths }
      : {}),
    ...(options.audit
      ? {
          "x-changed-file-audit": {
            claimToken: options.audit.claimToken,
            mergeTargetRef: options.audit.mergeTargetRef,
            fresh: options.audit.fresh,
            mergeable: options.audit.mergeable,
            passed: options.audit.passed,
            changedPaths: options.audit.changedPaths,
            diagnostics: options.audit.diagnostics,
            renameDiagnostics: options.audit.renameDiagnostics,
          },
        }
      : {}),
  };
}

function selectUnlockedPaths(
  claimToken: string,
  changedPaths: string[],
  locks: readonly RuntimeLockRecord[]
): string[] {
  return changedPaths.filter(
    (changedPath) =>
      !locks.some(
        (lock) => lock.claim_token === claimToken && lock.path === changedPath
      )
  );
}

function haltClaimExecution(
  store: RuntimeSqliteStore,
  claimToken: string,
  options: {
    reason: RuntimeExecutionHaltedReason;
    code: string;
    message?: string;
    dirtyPaths?: string[];
    unlockedPaths?: string[];
    audit?: RuntimeChangedFileAuditResult;
  }
): ReturnType<RuntimeSqliteStore["haltRuntimeExecution"]> {
  return store.haltRuntimeExecution(claimToken, {
    reason: options.reason,
    detail: buildHaltDetail(options),
  });
}

// --- DOMAIN: claim ---
const claim = program
  .command("claim")
  .description("Runtime claim command surface")
  .showHelpAfterError(true);

claim.action(async () => {
  try {
    const store = claimExecutionStore(runtimeRootDir());
    try {
      const claims = store
        .listClaims()
        .filter((entry) => entry.state === "active");
      const text = formatRuntimeClaimListText(claims);
      if (text.length > 0) {
        console.log(text);
      }
    } finally {
      store.close();
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

        const store = claimExecutionStore(runtimeRootDir());
        try {
          if (opts.filter) {
            const cutoff = parseTimeFilter(opts.filter);
            const claims = store
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

          const existingClaim = store.getClaimByToken(claimToken!);
          const claim = existingClaim
            ? store.touchClaimContext(claimToken!)
            : undefined;
          if (opts.json) {
            printTaskJson({
              claimToken,
              state: claim?.state ?? "missing",
              claim: claim ?? null,
            });
          } else {
            console.log(formatRuntimeClaimStatusText(claim, claimToken));
          }
        } finally {
          store.close();
        }
      } catch (error) {
        failTaskCommand(error, opts.json);
      }
    }
  );

claim
  .command("create")
  .description("Create a runtime claim for a task target")
  .requiredOption(
    "--target <target>",
    "Claim target in the form task:<task-id>"
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
        const model = await loadTaskModel(target.targetId, {});
        assertTaskClaimable(model);
        const ttlMinutes = parseOptionalFiniteMinutes(opts.ttlMinutes);
        const result = createRuntimeClaim(target, {
          holder: opts.holder,
          branch: opts.branch,
          worktree: opts.worktree,
          ttlMinutes,
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
      }
    ) => {
      try {
        const outcome = parseClaimReleaseOutcome(opts.outcome);
        if (outcome === "success") {
          await runClaimSuccessRelease(claimToken, opts);
          return;
        }
        if (opts.porcelain || opts.dryRun) {
          throw new TaskCommandError(
            "CLAIM_RELEASE_OPTION_CONFLICT",
            "--porcelain and --dry-run only apply to --outcome success.",
            { outcome }
          );
        }
        if (outcome === "failed") {
          runClaimFailedRelease(claimToken, opts);
          return;
        }
        await runClaimHaltedRelease(claimToken, {
          reason: outcome,
          code: opts.code,
          message: opts.message,
          json: opts.json,
        });
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

        const result = opts.expired
          ? withClaimExecutionStore((store) =>
              store.pruneRuntimeClaims(parseTimeFilter(opts.expired!))
            )
          : withClaimExecutionStore((store) =>
              store.removeRuntimeClaim(claimToken!)
            );
        emitRuntimeClaimCleanupResult(result, opts.json);
      } catch (error) {
        failTaskCommand(error, opts.json);
      }
    }
  );

function runtimeStore(): RuntimeSqliteStore {
  return openRuntimeSqliteStore({ rootDir: process.cwd() });
}

function withClaimExecutionStore<T>(
  callback: (store: RuntimeSqliteStore) => T
): T {
  const store = claimExecutionStore(runtimeRootDir());
  try {
    return callback(store);
  } finally {
    store.close();
  }
}

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
  .action((files: string[], opts: { strict?: boolean }) => {
    const args = [...(opts.strict ? ["--strict"] : []), ...(files ?? [])];
    const success = validateWorkManagementFrontmatter(args);
    if (!success) {
      process.exit(1);
    }
  });

// --- DOMAIN: work items ---
function registerWorkCommandSurface(surface: Command): void {
  const graph = surface
    .command("graph")
    .description("Inspect the projected read-only Work graph");

  graph
    .command("nodes")
    .description("List projected graph nodes")
    .addOption(createWorkGraphFormatOption())
    .option(
      "--node-type <type>",
      "Filter by projected node type; repeat or use comma-separated values",
      collectCsvOption,
      [],
    )
    .action(
      async (opts: {
        format: WorkGraphExplorerFormat;
        nodeType?: string[];
      }) => {
        await writeProjectedWorkGraph(opts.format, (projection) =>
          queryWorkGraphNodes(projection, {
            nodeTypes: parseGraphNodeTypes(opts.nodeType),
          }),
        );
      },
    );

  graph
    .command("edges")
    .description("List projected graph edges")
    .addOption(createWorkGraphFormatOption())
    .option(
      "--edge-type <type>",
      "Filter by projected edge type; repeat or use comma-separated values",
      collectCsvOption,
      [],
    )
    .option(
      "--source <node-id>",
      "Filter by source node id; repeat or use comma-separated values",
      collectCsvOption,
      [],
    )
    .option(
      "--target <node-id>",
      "Filter by target node id; repeat or use comma-separated values",
      collectCsvOption,
      [],
    )
    .option(
      "--node <node-id>",
      "Filter to a one-node edge neighborhood; repeat or use comma-separated values",
      collectCsvOption,
      [],
    )
    .action(
      async (opts: {
        format: WorkGraphExplorerFormat;
        edgeType?: string[];
        source?: string[];
        target?: string[];
        node?: string[];
      }) => {
        await writeProjectedWorkGraph(opts.format, (projection) =>
          queryWorkGraphEdges(projection, {
            edgeTypes: parseGraphEdgeTypes(opts.edgeType),
            sourceNodeIds: opts.source ?? [],
            targetNodeIds: opts.target ?? [],
            nodeIds: opts.node ?? [],
          }),
        );
      },
    );

  graph
    .command("inspect")
    .description("Inspect one projected node and its one-node neighborhood")
    .argument("<node-id>", "Projected node id to inspect")
    .addOption(createWorkGraphFormatOption())
    .action(
      async (
        nodeId: string,
        opts: {
          format: WorkGraphExplorerFormat;
        },
      ) => {
        await writeProjectedWorkGraph(opts.format, (projection) =>
          inspectWorkGraphNode(projection, nodeId),
        );
      },
    );

  surface
    .command("list")
    .description("List open backlog work items")
    .option("--json", "Emit machine-readable JSON")
    .option("--porcelain", "Emit stable script-friendly work item lines")
    .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
    .action(
      async (opts: {
        json?: boolean;
        porcelain?: boolean;
        backlogDir?: string;
      }) => {
        try {
          if (opts.json && opts.porcelain) {
            throw new TaskCommandError(
              "TASK_LIST_FORMAT_CONFLICT",
              "Use either --json or --porcelain, not both."
            );
          }
          const tasks = (
            await listTaskModels({ backlogDir: opts.backlogDir })
          ).sort((left, right) => left.id.localeCompare(right.id));
          if (opts.json) {
            printTaskJson({
              schemaVersion: "task-list/v1",
              tasks: tasks.map((task) => ({
                id: task.id,
                status: task.status,
                title: task.title,
                filePath: task.filePath,
                lifecycle: task.lifecycle,
                ...(task.statusReason
                  ? { statusReason: task.statusReason }
                  : {}),
                runtime: task.runtime,
              })),
            });
            return;
          }
          const output = opts.porcelain
            ? formatTaskListPorcelain(tasks)
            : formatTaskListText(tasks);
          if (output.length > 0) {
            console.log(output);
          }
        } catch (error) {
          failTaskCommand(error, opts.json);
        }
      }
    );

  surface
    .command("ready")
    .description("List fail-closed AFK-ready work item candidates")
    .option("--json", "Emit deterministic candidate and exclusion JSON")
    .option("--candidates-only", "Omit exclusions from JSON output")
    .option("--porcelain", "Emit stable script-friendly candidate lines")
    .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
    .action(
      async (opts: {
        json?: boolean;
        candidatesOnly?: boolean;
        porcelain?: boolean;
        backlogDir?: string;
      }) => {
        try {
          if (opts.json && opts.porcelain) {
            throw new TaskCommandError(
              "TASK_READY_FORMAT_CONFLICT",
              "Use either --json or --porcelain, not both."
            );
          }
          if (opts.candidatesOnly && !opts.json) {
            throw new TaskCommandError(
              "TASK_READY_CANDIDATES_ONLY_REQUIRES_JSON",
              "Use --candidates-only with --json."
            );
          }
          const report = await selectReadyTasks({
            backlogDir: opts.backlogDir,
          });
          if (opts.json) {
            printTaskJson(
              opts.candidatesOnly
                ? {
                    schemaVersion: report.schemaVersion,
                    candidates: report.candidates,
                  }
                : report
            );
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
      }
    );

  surface
    .command("show")
    .description("Show canonical work item context")
    .argument(
      "<task-id>",
      "Work item id, numeric id, or work item file basename"
    )
    .option("--json", "Emit canonical work item JSON")
    .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
    .action(
      async (taskId: string, opts: { json?: boolean; backlogDir?: string }) => {
        try {
          const model = await loadCanonicalTask({
            taskId,
            backlogDir: opts.backlogDir,
          });
          if (opts.json) {
            printTaskJson(model);
            return;
          }
          console.log(await renderHumanTask({ task: model }));
        } catch (error) {
          failTaskCommand(error, opts.json);
        }
      }
    );

  surface
    .command("status")
    .description("Show operational work item status and recovery diagnostics")
    .argument(
      "<task-id>",
      "Work item id, numeric id, or work item file basename"
    )
    .option("--json", "Emit operational work item status JSON")
    .option("--worktree <path>", "Inspect status from a specific worktree")
    .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
    .action(
      async (
        taskId: string,
        opts: {
          json?: boolean;
          worktree?: string;
          backlogDir?: string;
        }
      ) => {
        try {
          const commandRootDir = process.cwd();
          const initialRootDir = opts.worktree
            ? path.resolve(opts.worktree)
            : commandRootDir;
          const initialModel = await loadTaskModel(taskId, {
            rootDir: initialRootDir,
            backlogDir: opts.backlogDir,
          });
          const resolvedWorktree = opts.worktree
            ? path.resolve(opts.worktree)
            : resolveTaskStatusWorktree(initialModel, commandRootDir);
          const rootDir = resolvedWorktree ?? initialRootDir;
          const model = await loadTaskModel(taskId, {
            rootDir,
            backlogDir: opts.backlogDir,
          });
          const report = buildTaskStatusReport(model, {
            rootDir,
            worktree: resolvedWorktree,
          });
          if (opts.json) {
            printTaskJson(report);
            return;
          }
          console.log(formatTaskStatusText(report));
        } catch (error) {
          failTaskCommand(error, opts.json);
        }
      }
    );

  surface
    .command("prompt")
    .description(
      "Render a Sandcastle-oriented prompt from canonical work item JSON"
    )
    .argument(
      "<task-id>",
      "Work item id, numeric id, or work item file basename"
    )
    .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
    .action(async (taskId: string, opts: { backlogDir?: string }) => {
      try {
        const model = await loadCanonicalTask({
          taskId,
          backlogDir: opts.backlogDir,
        });
        console.log(await renderSandcastlePrompt({ task: model }));
      } catch (error) {
        failTaskCommand(error);
      }
    });

  surface
    .command("claim")
    .description("Create a conservative local work item claim")
    .argument(
      "<task-id>",
      "Work item id, numeric id, or work item file basename"
    )
    .option("--json", "Emit machine-readable JSON")
    .option("--holder <holder>", "Claim holder identity")
    .option("--branch <branch>", "Branch or ref context")
    .option("--worktree <path>", "Worktree path")
    .option("--ttl-minutes <minutes>", "Claim time-to-live in minutes")
    .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
    .action(
      async (
        taskId: string,
        opts: {
          json?: boolean;
          holder?: string;
          branch?: string;
          worktree?: string;
          ttlMinutes?: string;
          backlogDir?: string;
        }
      ) => {
        try {
          const ttlMinutes =
            typeof opts.ttlMinutes === "string"
              ? Number.parseInt(opts.ttlMinutes, 10)
              : undefined;
          if (ttlMinutes !== undefined && !Number.isFinite(ttlMinutes)) {
            throw new TaskCommandError(
              "TASK_CLAIM_INVALID_TTL",
              "Claim TTL must be a finite number of minutes."
            );
          }
          const initialRootDir = resolveGitRoot(opts.worktree);
          const initialModel = await loadTaskModel(taskId, {
            rootDir: initialRootDir,
            backlogDir: opts.backlogDir,
          });
          const authority = resolveTaskAuthority({
            rootDir: initialRootDir,
            taskId: initialModel.id,
            runtimeBranch: initialModel.runtime?.latestExecutionLog?.branch,
            worktree: opts.worktree,
          });
          const branch = opts.branch ?? authority.branch;
          let model = await loadTaskModel(taskId, {
            rootDir: authority.rootDir,
            backlogDir: opts.backlogDir,
          });
          model = await recoverTaskIfSafelyRecoverable(model, {
            holder: opts.holder,
            branch,
            worktree: authority.rootDir,
            ttlMinutes,
            backlogDir: opts.backlogDir,
          });
          assertTaskClaimable(model);
          const result = createRuntimeClaim(
            { targetType: "task", targetId: model.id },
            {
              rootDir: authority.rootDir,
              holder: opts.holder,
              branch,
              worktree: opts.worktree,
              ttlMinutes,
            }
          );
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

  surface
    .command("recover")
    .description("Recover a halted work item and make it claimable again")
    .argument(
      "<task-id>",
      "Work item id, numeric id, or work item file basename"
    )
    .option("--holder <holder>", "Claim holder identity")
    .option("--branch <branch>", "Branch or ref context")
    .option("--worktree <path>", "Run recovery in a specific worktree")
    .option("--ttl-minutes <minutes>", "Claim time-to-live in minutes")
    .option("--force <mode>", recoveryForceHelp())
    .option(
      "--dry-run",
      "Validate recovery without acquiring claims or writing files"
    )
    .option("--json", "Emit machine-readable JSON")
    .option("--backlog-dir <path>", "Path to the backlog directory", "backlog")
    .action(
      async (
        taskId: string,
        opts: {
          holder?: string;
          branch?: string;
          worktree?: string;
          ttlMinutes?: string;
          force?: string;
          dryRun?: boolean;
          json?: boolean;
          backlogDir?: string;
        }
      ) => {
        try {
          await runTaskRecoveryCommand(taskId, opts);
        } catch (error) {
          failTaskCommand(error, opts.json);
        }
      }
    );

  surface
    .command("record")
    .description("Create and link claim-scoped work item evidence")
    .requiredOption("--claim <claim-id>", "Active claim id")
    .requiredOption("--type <record-type>", "Record subtype, e.g. test-result")
    .requiredOption(
      "--payload <json-file|->",
      "Record payload JSON file or stdin"
    )
    .option("--json", "Emit machine-readable JSON")
    .option("--porcelain", "Emit stable script-friendly output")
    .option(
      "--consumer-config <path>",
      "Path to consumer config JSON",
      ".doc-vader/backlog-consumer.json"
    )
    .option("--dry-run", "Validate and render mutation without writing files")
    .action(
      async (opts: {
        claim: string;
        type: string;
        payload: string;
        json?: boolean;
        porcelain?: boolean;
        consumerConfig?: string;
        dryRun?: boolean;
      }) => {
        try {
          if (opts.json && opts.porcelain) {
            throw new Error("Use either --json or --porcelain, not both.");
          }
          const payload = await readRecordPayload(opts.payload, process.stdin);
          const result = await recordTaskEvidence({
            claimId: opts.claim,
            type: opts.type,
            payload,
            consumerConfig: opts.consumerConfig,
            dryRun: opts.dryRun,
          });
          if (opts.json) {
            printTaskJson(result);
            return;
          }
          if (opts.porcelain) {
            printTaskPorcelain([
              result.claimId,
              result.taskId,
              result.record.id,
              result.evidenceLink,
              result.record.filePath,
            ]);
            return;
          }
          console.log(`${result.taskId} ${result.evidenceLink}`);
        } catch (error) {
          failTaskCommand(error, opts.json);
        }
      }
    );
}

const workCommand = program
  .command("work")
  .description("Work Item command surface")
  .alias("wi")
  .alias("task");
registerWorkCommandSurface(workCommand);

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
      const store = runtimeStore();
      try {
        const result = store.acquireRuntimeLocks(opts.claim, paths);
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
      } finally {
        store.close();
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
      const store = runtimeStore();
      try {
        const result = store.removeRuntimeLocks(opts.claim, paths);
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
      } finally {
        store.close();
      }
    }
  );

lock
  .command("status")
  .description("Show the current locks for a claim")
  .requiredOption("--claim <claim-token>", "Active runtime claim token")
  .option("--json", "Emit machine-readable JSON")
  .action(async (opts: { claim: string; json?: boolean }) => {
    const store = runtimeStore();
    try {
      const result = store.getLockStatus(opts.claim);
      if (opts.json) {
        printTaskJson(result);
      } else {
        console.log(formatRuntimeLockStatusText(result));
      }
    } catch (error) {
      failTaskCommand(error, opts.json);
    } finally {
      store.close();
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
    "Provider: github|gitlab|bitbucket|subversion"
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
  .description("Legacy compatibility aliases for task work-item mutations");

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
          `--actual must be a valid finite number, got: "${opts.actual}"`
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
          ", "
        )}`
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
          `--actual must be a valid finite number, got: "${opts.actual}"`
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
  .description("Create an append-only record artifact from a validated payload")
  .requiredOption("--type <record-type>", "Record subtype, e.g. test-result")
  .requiredOption(
    "--payload <json-file|->",
    "Record payload JSON file or stdin"
  )
  .option("--json", "Emit machine-readable JSON")
  .option("--porcelain", "Emit stable script-friendly output")
  .option("--consumer-config <path>", "Path to consumer config JSON")
  .option("--dry-run", "Show the mutation without writing files")
  .action(
    async (opts: {
      type: string;
      payload: string;
      json?: boolean;
      porcelain?: boolean;
      consumerConfig?: string;
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
