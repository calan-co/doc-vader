import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";
import {
  assertClaimAuthorityAvailable,
  ClaimAuthorityUnavailableError,
  initializeClaimAuthority,
} from "../claim/index.js";
import {
  assertActiveRuntimeClaimForTask,
  auditRuntimeClaimCoverage,
  createRuntimeClaimCommandApi,
  resolveRuntimeClaimAuthority,
} from "../runtime-claim/index.js";
import { isOperationalArtifact } from "../operational-artifacts.js";
import {
  getEscalation,
  preflightEscalationUse,
  EscalationError,
  WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY,
} from "../escalation/index.js";
import { executeEscalatedWorkCheckUse, recoverEscalatedWorkCheckUses } from "./escalation-use-saga.js";
import { collectBranchDiffPaths } from "../task/recovery-state.js";
import {
  createRecoveryTrace,
  finalizeRecoveryTrace,
  TASK_RECOVERY_TRACE_ENV,
} from "../task/recovery-trace.js";
import {
  getRuntimeClaimDefaultTtlMilliseconds,
  type RuntimeChangedFileAuditResult,
  type RuntimeExecutionHaltDetail,
  type RuntimeExecutionHaltedReason,
} from "../runtime/index.js";
import { transition as transitionWorkItem } from "../controllers/workManagementController.js";
import { assertTaskClaimable } from "../task/claimability.js";
import { TaskCommandError } from "../task/errors.js";
import { loadTaskModel } from "../task/model.js";
import { loadTaskPromptModel } from "../task/prompt.js";
import { readRecordPayload, recordTaskEvidence } from "../task/record.js";
import {
  recoverTaskClaim,
  type RecoverTaskClaimResult,
  type TaskRecoveryForceMode,
} from "../task/recover.js";
import { loadTaskShowModel, renderHumanTaskShow } from "../task/show.js";
import { buildTaskStatusReport } from "../task/status.js";
import {
  readTaskAuthorityGitContext,
  resolveGitRoot,
  resolveTaskAuthorityFromGitContext,
} from "../task/authority.js";
import { completeTaskClaim } from "../task/complete.js";
import { renderSandcastlePrompt } from "../task/canonical.js";
import {
  optionsFromTransitionPayload,
  readTaskTransitionPayload,
  validateTaskTransitionPayload,
} from "../task/transition.js";
import {
  completeWorkItemCheckWithEvidence,
  planWorkItemCheck,
  assertWorkItemRunningCategory,
  authorizeWorkMutation,
  inspectWorkItemChecklist,
  inspectWorkItemQualifiers,
  mutateWorkItemCheck,
  type WorkItemCheckEvidence,
} from "../work-management/index.js";
import type { WorkModel } from "./list.js";

export const CLAIM_RELEASE_OUTCOMES = [
  "success",
  "failed",
  "conflict",
  "blocked",
  "invalid",
  "expired",
  "revoked",
  "cancelled",
] as const;

type ClaimReleaseOutcome = (typeof CLAIM_RELEASE_OUTCOMES)[number];
const claimReleaseOutcomeSet = new Set<string>(CLAIM_RELEASE_OUTCOMES);
const haltingReasonSet = new Set<string>(CLAIM_RELEASE_OUTCOMES.slice(2));

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

function runtimeClaimCommands(rootDir: string) {
  return createRuntimeClaimCommandApi({ rootDir });
}

function claimLifecycleAuthorityRootDir(): string {
  const rootDir = runtimeRootDir();
  initializeClaimAuthority({ rootDir });
  return rootDir;
}

function parseOptionalFiniteMinutes(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsedMinutes = Number.parseInt(value, 10);
  if (!Number.isFinite(parsedMinutes)) {
    throw new TaskCommandError("CLAIM_INVALID_TTL", "Claim TTL must be a finite number of minutes.", { ttlMinutes: value });
  }
  return parsedMinutes;
}

function parseRecoveryForceMode(value: string | undefined): TaskRecoveryForceMode | undefined {
  if (value === undefined) return undefined;
  if (value === "reset" || value === "reconcile") return value;
  throw new TaskCommandError("TASK_RECOVERY_INVALID_FORCE_MODE", "Force mode must be reset or reconcile.", { force: value });
}

function parseTaskNumber(value: string | undefined, optionName: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TaskCommandError("TASK_INVALID_NUMBER", `${optionName} must be a finite number.`, { optionName, value });
  }
  return parsed;
}

function parseClaimReleaseOutcome(value: string): ClaimReleaseOutcome {
  if (claimReleaseOutcomeSet.has(value)) return value as ClaimReleaseOutcome;
  throw new TaskCommandError(
    "CLAIM_INVALID_OUTCOME",
    `Claim release outcome must be one of ${CLAIM_RELEASE_OUTCOMES.join(", ")}.`,
    { outcome: value },
  );
}

async function resolveTaskRecoveryContext(taskId: string, options: { worktree?: string; backlogDir?: string } = {}): Promise<{
  taskId: string;
  rootDir: string | undefined;
  branch?: string | null;
  worktree?: string;
}> {
  const authorityContext = await readTaskAuthorityGitContext(options.worktree);
  const model = await loadTaskModel(taskId, { rootDir: authorityContext.rootDir, backlogDir: options.backlogDir });
  const authority = resolveTaskAuthorityFromGitContext({
    rootDir: authorityContext.rootDir,
    taskId: model.id,
    runtimeWorktree: model.runtime?.latestExecutionLog?.worktree,
    runtimeWorktreeInvalid: model.runtime?.latestExecutionLog?.worktreeMetadataInvalid,
    worktree: options.worktree,
  }, authorityContext);
  if (authority.source === "runtime-worktree-unavailable") {
    throw new TaskCommandError("TASK_AUTHORITY_UNAVAILABLE", "Task runtime worktree metadata is unavailable.", authority.unavailable);
  }
  return {
    taskId: model.id,
    rootDir: authority.source === "current-root" ? undefined : authority.rootDir,
    ...(authority.source === "runtime-worktree" ? { branch: authority.branch ?? null, worktree: authority.rootDir } : {}),
    ...(authority.source === "explicit-worktree" ? { worktree: authority.rootDir } : {}),
  };
}

async function recoverTaskIfSafelyRecoverable(task: WorkModel, options: {
  holder?: string;
  branch?: string;
  worktree?: string;
  ttlMinutes?: number;
  backlogDir?: string;
} = {}): Promise<WorkModel> {
  if (task.runtime?.ready !== false) return task;
  const latestExecutionLog = task.runtime.latestExecutionLog;
  if (latestExecutionLog?.state !== "running" || latestExecutionLog.reason !== "started" || latestExecutionLog.claimState === "active" || (latestExecutionLog.lockCount ?? 0) !== 0) return task;

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
    await recoverTaskClaim({ ...recoveryOptions, dryRun: true });
  } catch {
    return task;
  }
  await recoverTaskClaim(recoveryOptions);
  return loadTaskModel(task.id, { rootDir, backlogDir: options.backlogDir });
}

function collectChangedPaths(rootDir: string): string[] {
  // Kept in the CLI operation layer because this determines only initial claim locks.
  try {
    const output = execFileSync("git", ["status", "--porcelain=v1", "-uall"], {
      cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
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

function createRuntimeClaim(target: { targetType: string; targetId: string }, opts: {
  rootDir?: string;
  holder?: string;
  branch?: string | null;
  worktree?: string;
  ttlMinutes?: number;
  initialLockPaths?: string[];
}) {
  const now = new Date();
  const ttlMilliseconds = opts.ttlMinutes === undefined
    ? getRuntimeClaimDefaultTtlMilliseconds()
    : opts.ttlMinutes * 60_000;
  return runtimeClaimCommands(resolveGitRoot(opts.rootDir)).acquireClaim({
    schema_version: "runtime-entity/v1",
    target_type: target.targetType,
    target_id: target.targetId,
    holder: opts.holder?.trim() || "local-agent",
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMilliseconds).toISOString(),
    ...(opts.branch || opts.worktree ? { metadata: { ...(opts.branch ? { branch: opts.branch } : {}), ...(opts.worktree ? { worktree: opts.worktree } : {}) } } : {}),
    entropy: randomUUID(),
  }, opts.initialLockPaths ?? []);
}

function normalizeRuntimeDetailCode(code: string): { code: string; sourceCode?: string } {
  const sourceCode = code.trim();
  const normalizedCode = sourceCode.toLowerCase().replace(/_/g, "-");
  if (!/^(?:x-[a-z0-9]+(?:-[a-z0-9]+)*|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/.test(normalizedCode)) {
    throw new TaskCommandError("CLAIM_RELEASE_INVALID_CODE", "--code must be a source-style code or an uppercase underscore-delimited task diagnostic code.", { code: sourceCode });
  }
  return { code: normalizedCode, ...(normalizedCode === sourceCode ? {} : { sourceCode }) };
}

function buildHaltDetail(options: { code: string; message?: string; dirtyPaths?: string[]; unlockedPaths?: string[]; audit?: RuntimeChangedFileAuditResult }): RuntimeExecutionHaltDetail {
  const normalizedCode = normalizeRuntimeDetailCode(options.code);
  return {
    code: normalizedCode.code,
    ...(normalizedCode.sourceCode ? { "x-source-code": normalizedCode.sourceCode } : {}),
    ...(options.message ? { message: options.message } : {}),
    ...(options.dirtyPaths && options.dirtyPaths.length > 0 ? { "x-dirty-paths": options.dirtyPaths } : {}),
    ...(options.unlockedPaths && options.unlockedPaths.length > 0 ? { "x-unlocked-paths": options.unlockedPaths } : {}),
    ...(options.audit ? { "x-changed-file-audit": {
      claimToken: options.audit.claimToken, mergeTargetRef: options.audit.mergeTargetRef,
      fresh: options.audit.fresh, mergeable: options.audit.mergeable, passed: options.audit.passed,
      changedPaths: options.audit.changedPaths, diagnostics: options.audit.diagnostics,
      renameDiagnostics: options.audit.renameDiagnostics,
    } } : {}),
  };
}

export async function showWorkCommand(options: { taskId: string; backlogDir?: string }) {
  return loadTaskShowModel({ taskId: options.taskId, backlogDir: options.backlogDir });
}

export async function renderWorkShowCommand(options: { taskId: string; backlogDir?: string }) {
  return renderHumanTaskShow({ task: await showWorkCommand(options) });
}

export async function statusWorkCommand(options: { taskId: string; worktree?: string; backlogDir?: string }) {
  const authorityContext = await readTaskAuthorityGitContext(options.worktree);
  const initialModel = await loadTaskModel(options.taskId, { rootDir: authorityContext.rootDir, backlogDir: options.backlogDir });
  const authority = resolveTaskAuthorityFromGitContext({
    rootDir: authorityContext.rootDir, taskId: initialModel.id,
    runtimeWorktree: initialModel.runtime?.latestExecutionLog?.worktree,
    runtimeWorktreeInvalid: initialModel.runtime?.latestExecutionLog?.worktreeMetadataInvalid,
    worktree: options.worktree,
  }, authorityContext);
  if (authority.source === "runtime-worktree-unavailable") {
    throw new TaskCommandError("TASK_AUTHORITY_UNAVAILABLE", "Task runtime worktree metadata is unavailable.", authority.unavailable);
  }
  const rootDir = authority.rootDir;
  assertWorkClaimAuthority(rootDir);
  const model = rootDir === authorityContext.rootDir ? initialModel : await loadTaskModel(options.taskId, { rootDir, backlogDir: options.backlogDir });
  return buildTaskStatusReport(model, {
    rootDir,
    ...(authority.source === "current-root" ? {} : { worktree: authority.rootDir }),
    ...(authority.source === "runtime-worktree" ? { expectedBranch: authority.branch ?? null } : {}),
    backlogDir: options.backlogDir,
  });
}

export async function updateWorkCommand(options: {
  taskId: string; status: string; reason?: string; statusReason?: string; status_reason?: string;
  actual?: string | number; clearEstimated?: boolean; assignee?: string; claim?: string; consumerConfig?: string; backlogDir?: string; dryRun?: boolean;
}) {
  let actual: number | undefined;
  if (options.actual !== undefined) {
    const parsed = Number(options.actual);
    if (!Number.isFinite(parsed)) {
      throw new TaskCommandError("TASK_UPDATE_INVALID_ACTUAL", `--actual must be a valid finite number, got: "${options.actual}"`);
    }
    actual = parsed;
  }
  assertWorkClaimAuthority(runtimeRootDir());
  const model = await loadTaskModel(options.taskId, { backlogDir: options.backlogDir });
  return transitionWorkItem({
    id: model.id, status: options.status,
    statusReason: options.statusReason ?? options.status_reason ?? options.reason,
    actual, clearEstimated: options.clearEstimated, assignee: options.assignee, claimToken: options.claim,
    consumerConfig: options.consumerConfig, dryRun: options.dryRun,
  });
}

export async function updateWorkFromInputCommand(options: {
  taskId: string; input?: string; escalation?: string; claim?: string; consumerConfig?: string; backlogDir?: string; dryRun?: boolean; stdin?: NodeJS.ReadStream;
}) {
  if (options.escalation) {
    if (options.input) throw new TaskCommandError("WORK_ESCALATION_INPUT_CONFLICT", "Use either --input or --escalation, not both.");
    if (!options.claim) throw new TaskCommandError("WORK_ESCALATION_CLAIM_REQUIRED", "Running checklist composition requires an active execution claim.");
    try {
      const rootDir = path.resolve(process.cwd());
      const escalation = getEscalation({ escalationId: options.escalation });
      if (escalation.policy !== WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY) throw new TaskCommandError("WORK_ESCALATION_POLICY_INVALID", "Escalation policy is not permitted for Work updates.");
      const checklist = await inspectWorkChecklistCommand({ taskId: options.taskId, checklistId: escalation.payload.composition.checklistId, consumerConfig: options.consumerConfig, backlogDir: options.backlogDir });
      if (!checklist.checklist.checks.some((check) => check.id === escalation.payload.composition.checkId)) throw new TaskCommandError("WORK_ESCALATION_CHECK_UNKNOWN", "Escalation composition does not address a current Work check.");
      await assertWorkItemRunningCategory({ id: options.taskId, consumerConfig: options.consumerConfig });
      if (options.dryRun) throw new TaskCommandError("WORK_ESCALATION_DRY_RUN_UNSUPPORTED", "Escalated checklist composition does not support dry-run.");
      assertActiveRuntimeClaimForTask({ rootDir, taskId: options.taskId, claimToken: options.claim });
      authorizeWorkMutation({ rootDir, taskId: options.taskId, claimToken: options.claim, requiredPaths: [checklist.filePath] });
      await recoverEscalatedWorkCheckUses({ rootDir, escalationId: escalation.id });
      const freshEscalation = preflightEscalationUse({ rootDir, escalationId: escalation.id, workItemId: options.taskId });
      const plan = await planWorkItemCheck({
        rootDir,
        id: options.taskId,
        checklistId: freshEscalation.payload.composition.checklistId,
        checkId: freshEscalation.payload.composition.checkId,
        action: freshEscalation.payload.composition.action,
        claimToken: options.claim,
        consumerConfig: options.consumerConfig,
      });
      const applied = await executeEscalatedWorkCheckUse({ rootDir, escalation: freshEscalation, claimToken: options.claim, plan });
      return { ...applied.result, escalation: applied.escalation };
    } catch (error) {
      if (error instanceof TaskCommandError) throw error;
      if (error instanceof EscalationError) throw new TaskCommandError(error.code, error.message);
      throw error;
    }
  }
  if (!options.input) throw new TaskCommandError("TASK_TRANSITION_INPUT_REQUIRED", "Work updates require --input or --escalation.");
  const payload = options.input.trim().startsWith("{")
    ? validateTaskTransitionPayload(JSON.parse(options.input))
    : await readTaskTransitionPayload(options.input, options.stdin);
  return updateWorkCommand({
    taskId: options.taskId,
    ...optionsFromTransitionPayload(payload),
    claim: options.claim,
    consumerConfig: options.consumerConfig,
    backlogDir: options.backlogDir,
    dryRun: options.dryRun,
  });
}

export async function promptWorkCommand(options: { taskId: string; backlogDir?: string }) {
  return renderSandcastlePrompt({ task: await loadTaskPromptModel({ taskId: options.taskId, backlogDir: options.backlogDir }) });
}

export async function inspectWorkChecklistsCommand(options: { taskId: string; consumerConfig?: string; backlogDir?: string }) {
  const model = await loadTaskModel(options.taskId, { backlogDir: options.backlogDir });
  return inspectWorkItemQualifiers({ id: model.id, consumerConfig: options.consumerConfig });
}

export async function inspectWorkChecklistCommand(options: { taskId: string; checklistId: string; consumerConfig?: string; backlogDir?: string }) {
  const model = await loadTaskModel(options.taskId, { backlogDir: options.backlogDir });
  return inspectWorkItemChecklist({ id: model.id, checklistId: options.checklistId, consumerConfig: options.consumerConfig });
}

export async function mutateWorkChecklistCheckCommand(options: {
  taskId: string; checklistId: string; checkId: string; action: "complete" | "clear"; claim: string; consumerConfig?: string; backlogDir?: string;
}) {
  const model = await loadTaskModel(options.taskId, { backlogDir: options.backlogDir });
  return mutateWorkItemCheck({
    id: model.id, checklistId: options.checklistId, checkId: options.checkId, action: options.action,
    claimToken: options.claim, consumerConfig: options.consumerConfig,
  });
}

export async function completeWorkChecklistCheckCommand(options: {
  taskId: string; checklistId: string; checkId: string; claim: string; evidence: WorkItemCheckEvidence; evidenceType?: string; consumerConfig?: string; backlogDir?: string;
}) {
  const model = await loadTaskModel(options.taskId, { backlogDir: options.backlogDir });
  return completeWorkItemCheckWithEvidence({
    id: model.id, checklistId: options.checklistId, checkId: options.checkId, claimToken: options.claim,
    evidence: options.evidence, evidenceType: options.evidenceType, consumerConfig: options.consumerConfig,
  });
}

export async function claimWorkCommand(options: {
  taskId: string; holder?: string; branch?: string; worktree?: string; ttlMinutes?: string; backlogDir?: string;
}) {
  const ttlMinutes = typeof options.ttlMinutes === "string" ? Number(options.ttlMinutes) : undefined;
  if (ttlMinutes !== undefined && (!Number.isInteger(ttlMinutes) || ttlMinutes <= 0)) {
    throw new TaskCommandError("TASK_CLAIM_INVALID_TTL", "Claim TTL must be a positive whole number of minutes.");
  }
  const authorityContext = await readTaskAuthorityGitContext(options.worktree);
  const initialModel = await loadTaskModel(options.taskId, { rootDir: authorityContext.rootDir, backlogDir: options.backlogDir });
  const authority = resolveTaskAuthorityFromGitContext({
    rootDir: authorityContext.rootDir, taskId: initialModel.id,
    runtimeBranch: initialModel.runtime?.latestExecutionLog?.branch,
    runtimeWorktree: initialModel.runtime?.latestExecutionLog?.worktree,
    runtimeWorktreeInvalid: initialModel.runtime?.latestExecutionLog?.worktreeMetadataInvalid,
    worktree: options.worktree,
  }, authorityContext);
  if (authority.source === "runtime-worktree-unavailable") {
    throw new TaskCommandError("TASK_AUTHORITY_UNAVAILABLE", "Task runtime worktree metadata is unavailable.", authority.unavailable);
  }
  assertWorkClaimAuthority(authority.rootDir);
  const branch = options.branch ?? authority.branch;
  let model = await loadTaskModel(options.taskId, { rootDir: authority.rootDir, backlogDir: options.backlogDir });
  model = await recoverTaskIfSafelyRecoverable(model, { holder: options.holder, branch, worktree: authority.rootDir, ttlMinutes, backlogDir: options.backlogDir });
  assertTaskClaimable(model);
  return createRuntimeClaim({ targetType: "task", targetId: model.id }, {
    rootDir: authority.rootDir, holder: options.holder, branch, worktree: authority.rootDir, ttlMinutes,
    initialLockPaths: initialClaimLockPaths(authority.rootDir, model.filePath),
  });
}

export async function recoverWorkCommand(options: {
  taskId: string; holder?: string; branch?: string; worktree?: string; ttlMinutes?: string; force?: string; dryRun?: boolean; backlogDir?: string; json?: boolean;
}): Promise<RecoverTaskClaimResult | (RecoverTaskClaimResult & { recoveryTrace: ReturnType<typeof finalizeRecoveryTrace> })> {
  const trace = options.json && process.env[TASK_RECOVERY_TRACE_ENV] === "1" ? createRecoveryTrace() : undefined;
  if (trace) { trace.stages.cliTsxBootstrap.durationMs = performance.now(); trace.stages.cliTsxBootstrap.invocationCount = 1; }
  const ttlMinutes = parseOptionalFiniteMinutes(options.ttlMinutes);
  const force = parseRecoveryForceMode(options.force);
  const recoveryContext = await resolveTaskRecoveryContext(options.taskId, { worktree: options.worktree, backlogDir: options.backlogDir });
  const rootDir = recoveryContext.rootDir ?? runtimeRootDir();
  assertWorkClaimAuthority(rootDir);
  const operationStartedAt = performance.now();
  const result = await recoverTaskClaim({
    rootDir, taskId: recoveryContext.taskId, backlogDir: options.backlogDir, holder: options.holder,
    branch: options.branch ?? recoveryContext.branch, worktree: options.worktree ?? recoveryContext.worktree,
    ttlMinutes, force, dryRun: options.dryRun, trace,
  });
  if (trace) {
    trace.operationOnlyMs = performance.now() - operationStartedAt;
    return { ...result, recoveryTrace: finalizeRecoveryTrace(trace) };
  }
  return result;
}

export async function repairGeneratedEvidenceCommand(options: { claimToken: string; workItemPath: string; recordPath: string; dryRun?: boolean }): Promise<{ changed: string[]; dryRun: boolean }> {
  const rootDir = process.cwd();
  const claim = runtimeClaimCommands(rootDir).getClaimStatus(options.claimToken);
  if (!claim || claim.state !== "active" || claim.target_type !== "repair") {
    throw new TaskCommandError("REPAIR_CLAIM_REQUIRED", "An active repair:<completed-work-item-id> claim is required.");
  }
  const paths = [path.resolve(options.workItemPath), path.resolve(options.recordPath)];
  const workItem = await fs.readFile(paths[0], "utf8");
  if (!new RegExp(`^id:\\s*${claim.target_id}\\s*$`, "mi").test(workItem)) {
    throw new TaskCommandError("REPAIR_TARGET_MISMATCH", "Repair claim target does not match the Work Item being repaired.");
  }
  const audit = await auditRuntimeClaimCoverage({ rootDir, targetType: claim.target_type, targetId: claim.target_id, claimToken: options.claimToken, requiredPaths: paths, requiredPathsOnly: true });
  if (!audit.passed) throw new TaskCommandError("REPAIR_CLAIM_LOCK_AUDIT_FAILED", "Remediation claim does not own every repair path.", { audit });
  const replacements: Array<[RegExp, string]> = [
    [/^\s*-\s*'\[\[task-record-preflight\]\]'\s*\n/gm, ""],
    [/^- \d{4}-\d{2}-\d{2}: Closed as completed with evidence in backlog\/audit\/auditing-backlog-report\.json\.\s*\n/gm, ""],
    [/\[\[(commit:[^\]]+|command:[^\]]+|[^\]]+\.test\.mjs)\]\]/g, "$1"],
  ];
  const changed: string[] = [];
  for (const filePath of paths) {
    let content = await fs.readFile(filePath, "utf8");
    const original = content;
    for (const [pattern, replacement] of replacements) content = content.replace(pattern, replacement);
    content = content.replace(/\n{2,}$/u, "\n");
    if (content !== original) {
      changed.push(filePath);
      if (!options.dryRun) await fs.writeFile(filePath, content, "utf8");
    }
  }
  return { changed, dryRun: Boolean(options.dryRun) };
}

export async function recordWorkCommand(options: {
  claim: string; type: string; payloadPath: string; stdin?: NodeJS.ReadStream; consumerConfig?: string; dryRun?: boolean; json?: boolean; porcelain?: boolean;
}) {
  if (options.json && options.porcelain) throw new Error("Use either --json or --porcelain, not both.");
  assertWorkClaimAuthority(runtimeRootDir());
  const payload = await readRecordPayload(options.payloadPath, options.stdin);
  return recordTaskEvidence({ claimId: options.claim, type: options.type, payload, consumerConfig: options.consumerConfig, dryRun: options.dryRun });
}

export async function releaseClaimCommand(claimToken: string, options: {
  outcome: string; code: string; message?: string; json?: boolean; porcelain?: boolean; dryRun?: boolean; backlogDir?: string; consumerConfig?: string; actual?: string;
}) {
  const outcome = parseClaimReleaseOutcome(options.outcome);
  if (outcome === "success") {
    if (options.json && options.porcelain) throw new Error("Use either --json or --porcelain, not both.");
    const result = await completeTaskClaim({
      claimId: claimToken, rootDir: claimLifecycleAuthorityRootDir(), backlogDir: options.backlogDir,
      consumerConfig: options.consumerConfig, actual: parseTaskNumber(options.actual, "--actual"), dryRun: options.dryRun,
    });
    return { outcome, result } as const;
  }
  if (options.porcelain || options.dryRun) {
    throw new TaskCommandError("CLAIM_RELEASE_OPTION_CONFLICT", "--porcelain and --dry-run only apply to --outcome success.", { outcome });
  }
  const rootDir = claimLifecycleAuthorityRootDir();
  const commands = runtimeClaimCommands(rootDir);
  if (outcome === "failed") return { outcome, result: commands.failExecution(claimToken) } as const;
  if (!haltingReasonSet.has(outcome)) throw new TaskCommandError("CLAIM_INVALID_OUTCOME", "Unknown claim release outcome.");
  const runtimeClaim = commands.getClaimStatus(claimToken);
  if (!runtimeClaim) throw new TaskCommandError("TASK_RUNTIME_CLAIM_MISSING", `Runtime claim '${claimToken}' does not exist.`, { claimToken });
  const audit = await auditRuntimeClaimCoverage({ rootDir, targetType: runtimeClaim.target_type, targetId: runtimeClaim.target_id, claimToken, requiredPaths: [] });
  const result = commands.haltExecution(claimToken, { reason: outcome as RuntimeExecutionHaltedReason, detail: buildHaltDetail({
    code: options.code, message: options.message, dirtyPaths: audit.changedPaths,
    unlockedPaths: audit.diagnostics.filter((diagnostic) => diagnostic.actualLockState !== "owned").map((diagnostic) => diagnostic.path), audit,
  }) });
  if (outcome === "conflict" && options.code === "lock" && result.claim.target_type === "task") {
    try { await transitionWorkItem({ id: result.claim.target_id, status: "paused", statusReason: "system" }); }
    catch (error) { console.error(error instanceof Error ? error.message : String(error)); }
  }
  return { outcome, result } as const;
}
