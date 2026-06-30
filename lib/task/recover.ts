import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  openRuntimeSqliteStore,
  type RuntimeClaimAcquisitionSeed,
  type RuntimeClaimRecord,
  type RuntimeExecutionLogRecord,
  type RuntimeExecutionHaltedReason,
} from "../runtime/index.js";
import {
  runRuntimeClaimCoverageAudit,
  transitionWorkItem,
  type TransitionWorkItemResult,
} from "../work-management/index.js";
import { TaskCommandError } from "./errors.js";
import { loadTaskModel } from "./model.js";
import {
  collectTaskRecoveryGitState,
  isRecoverableReadyRuntimeState,
  type GitChangedPathEntry,
  type TaskRecoveryGitState,
} from "./recovery-state.js";

export type TaskRecoveryForceMode = "reset" | "reconcile";

export interface RecoverTaskClaimOptions {
  rootDir?: string;
  claimStorePath?: string;
  backlogDir?: string;
  consumerConfig?: string;
  taskId: string;
  holder?: string;
  branch?: string;
  worktree?: string;
  ttlMinutes?: number;
  force?: TaskRecoveryForceMode;
  dryRun?: boolean;
}

export interface RecoverTaskClaimCheckpoint {
  filePath: string;
  mode: TaskRecoveryForceMode;
}

export interface RecoverTaskClaimResult {
  taskId: string;
  dryRun: boolean;
  claimToken?: string;
  claim?: RuntimeClaimRecord;
  executionLogEntry?: RuntimeExecutionLogRecord;
  transition?: TransitionWorkItemResult;
  plannedInitialLockPaths?: string[];
  dirtyPaths?: GitChangedPathEntry[];
  gitState?: TaskRecoveryGitState;
  warnings?: string[];
  checkpoint?: RecoverTaskClaimCheckpoint;
  plannedCheckpoint?: {
    mode: TaskRecoveryForceMode;
    directory: string;
  };
}

interface RecoveryHaltedPathScope {
  dirtyPaths: Set<string>;
  unlockedPaths: Set<string>;
}

const DEFAULT_TTL_MINUTES = 240;
const RECOVERY_CHECKPOINT_DIR = ".doc-vader/runtime/recovery-checkpoints";

function gitOutput(rootDir: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function defaultMergeTargetRef(rootDir: string): string {
  for (const candidate of ["main", "master", "HEAD"]) {
    if (gitOutput(rootDir, ["rev-parse", "--verify", "--quiet", candidate])) {
      return candidate;
    }
  }
  return "HEAD";
}

function collectRecoveryBranchPaths(rootDir: string): string[] {
  const output = gitOutput(rootDir, [
    "diff",
    "--name-only",
    `${defaultMergeTargetRef(rootDir)}...HEAD`,
  ]);
  if (!output) {
    return [];
  }
  return output
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeHolder(holder: string | undefined): string {
  const value = holder?.trim();
  if (value) {
    return value;
  }
  return process.env.USER ?? process.env.USERNAME ?? "local-agent";
}

function normalizeRecoveryWorktreeMetadata(
  rootDir: string,
  worktree: string | undefined,
): string | undefined {
  const value = worktree?.trim();
  if (!value) {
    return undefined;
  }

  const resolvedRootDir = path.resolve(rootDir);
  const resolvedWorktree = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(resolvedRootDir, value);
  if (resolvedWorktree === resolvedRootDir) {
    return undefined;
  }

  const relative = path.relative(resolvedRootDir, resolvedWorktree);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => {
    return typeof entry === "string" && entry.trim().length > 0;
  }).map((entry) => entry.trim());
}

function restoreDirtyPaths(rootDir: string, entries: GitChangedPathEntry[]): void {
  const tracked = entries
    .filter((entry) => entry.status !== "??")
    .map((entry) => entry.path);
  const untracked = entries
    .filter((entry) => entry.status === "??")
    .map((entry) => entry.path);

  if (tracked.length > 0) {
    execFileSync(
      "git",
      ["restore", "--staged", "--worktree", "--source=HEAD", "--", ...tracked],
      {
        cwd: rootDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  }

  if (untracked.length > 0) {
    execFileSync("git", ["clean", "-f", "--", ...untracked], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
}

function loadLatestHaltedPathScope(
  rootDir: string,
  taskId: string,
): RecoveryHaltedPathScope | undefined {
  const store = openRuntimeSqliteStore({ rootDir });
  try {
    const latest = [...store.listExecutionLogEntries()]
      .reverse()
      .find(
        (entry) => entry.target_id === taskId && entry.state === "halted",
      );
    if (!latest) {
      return undefined;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(latest.payload) as unknown;
    } catch {
      return undefined;
    }
    if (typeof payload !== "object" || payload === null) {
      return undefined;
    }
    const detail = (payload as Record<string, unknown>).detail;
    if (typeof detail !== "object" || detail === null) {
      return undefined;
    }
    const dirtyPaths = asStringArray(
      (detail as Record<string, unknown>)["x-dirty-paths"],
    );
    const unlockedPaths = asStringArray(
      (detail as Record<string, unknown>)["x-unlocked-paths"],
    );
    if (dirtyPaths.length === 0 && unlockedPaths.length === 0) {
      return undefined;
    }
    return {
      dirtyPaths: new Set(dirtyPaths),
      unlockedPaths: new Set(unlockedPaths),
    };
  } finally {
    store.close();
  }
}

function buildRecoveryClaimSeed(options: {
  rootDir: string;
  taskId: string;
  holder: string;
  branch?: string;
  worktree?: string;
  now: Date;
  ttlMinutes: number;
}): RuntimeClaimAcquisitionSeed {
  const worktree = normalizeRecoveryWorktreeMetadata(
    options.rootDir,
    options.worktree,
  );
  const seed = {
    schema_version: "runtime-entity/v1" as const,
    target_type: "task",
    target_id: options.taskId,
    holder: options.holder,
    created_at: options.now.toISOString(),
    expires_at: new Date(
      options.now.getTime() + options.ttlMinutes * 60_000,
    ).toISOString(),
    entropy: randomUUID(),
  };
  if (options.branch === undefined && worktree === undefined) {
    return seed;
  }
  return {
    ...seed,
    metadata: {
      ...(options.branch ? { branch: options.branch } : {}),
      ...(worktree ? { worktree } : {}),
    },
  };
}

async function prepareRecoveryCheckpoint(options: {
  rootDir: string;
  taskId: string;
  claimToken: string;
  force?: TaskRecoveryForceMode;
  dirtyPaths: GitChangedPathEntry[];
}): Promise<RecoverTaskClaimCheckpoint | undefined> {
  switch (options.force) {
    case "reconcile":
      return writeRecoveryCheckpoint({
        rootDir: options.rootDir,
        taskId: options.taskId,
        claimToken: options.claimToken,
        mode: options.force,
        dirtyPaths: options.dirtyPaths,
      });
    case "reset":
    case undefined:
      return undefined;
  }
}

async function writeRecoveryCheckpoint(options: {
  rootDir: string;
  taskId: string;
  claimToken: string;
  mode: TaskRecoveryForceMode;
  dirtyPaths: GitChangedPathEntry[];
}): Promise<RecoverTaskClaimCheckpoint> {
  const checkpointDir = path.resolve(options.rootDir, RECOVERY_CHECKPOINT_DIR);
  const filePath = path.join(
    checkpointDir,
    `${options.taskId.replace(/^wi-/, "")}.json`,
  );
  await fs.mkdir(checkpointDir, { recursive: true });
  await fs.writeFile(
    filePath,
    `${JSON.stringify(
      {
        schema_version: "runtime-entity/v1",
        taskId: options.taskId,
        claimToken: options.claimToken,
        mode: options.mode,
        recordedAt: new Date().toISOString(),
        dirtyPaths: options.dirtyPaths,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return {
    filePath,
    mode: options.mode,
  };
}

function assertRecoverySafe(task: Awaited<ReturnType<typeof loadTaskModel>>): void {
  const failures: string[] = [];
  if (!task.validation.isActive) {
    failures.push("not-active");
  }
  if (!task.validation.isAfk) {
    failures.push("not-afk");
  }
  if (task.validation.isHitl) {
    failures.push("hitl");
  }
  if (!task.validation.dependenciesSatisfied) {
    failures.push("dependencies-not-satisfied");
  }
  const latestExecutionLog = task.runtime?.latestExecutionLog;
  if (!latestExecutionLog) {
    failures.push("runtime-missing");
  } else if (task.status !== "ready" && latestExecutionLog.state !== "halted") {
    failures.push("latest-execution-not-halted");
  }
  if (failures.length > 0) {
    throw new TaskCommandError(
      "TASK_RECOVERY_NOT_SAFE",
      `Task '${task.id}' is not eligible for recovery.`,
      {
        taskId: task.id,
        failures,
        latestExecutionLog: task.runtime?.latestExecutionLog ?? null,
      },
    );
  }
}

function assertRecoverableStatus(options: {
  task: Awaited<ReturnType<typeof loadTaskModel>>;
  gitState: TaskRecoveryGitState;
  force?: TaskRecoveryForceMode;
}): void {
  const { task, gitState } = options;
  const latestExecutionLog = task.runtime?.latestExecutionLog;
  const recoverableReadyState = isRecoverableReadyRuntimeState({
    status: task.status,
    runtime: task.runtime,
    gitState,
    allowUncertainLineage: Boolean(options.force),
  });
  const recoverableWithForce = isRecoverableReadyRuntimeState({
    status: task.status,
    runtime: task.runtime,
    gitState,
    allowUncertainLineage: true,
  });

  if (!options.force && recoverableWithForce && !recoverableReadyState) {
    throw new TaskCommandError(
      "TASK_RECOVERY_FORCE_REQUIRED",
      `Task '${task.id}' recovery needs --force because branch lineage or task-local changes cannot be proven safe.`,
      {
        taskId: task.id,
        status: task.status,
        latestExecutionLog: latestExecutionLog ?? null,
        gitState,
        forceModes: {
          reset: "Discard recoverable dirty paths before marking the task ready again.",
          reconcile: "Save a recovery checkpoint before discarding recoverable dirty paths.",
        },
        recommendation:
          "Inspect the current branch and dirty paths first. Pass --worktree when you can identify the intended recovery checkout. Use --force reset only when the current checkout is the intended task branch and the task-local dirty paths can be discarded; use --force reconcile when you want a checkpoint before discarding recoverable dirty paths.",
      },
    );
  }

  if (task.status !== "running" && task.status !== "paused" && !recoverableReadyState) {
    throw new TaskCommandError(
      "TASK_RECOVERY_INVALID_STATUS",
      `Task '${task.id}' is not in a recoverable state.`,
      {
        taskId: task.id,
        status: task.status,
        statusReason: task.statusReason ?? null,
        latestExecutionLog: latestExecutionLog ?? null,
        gitState,
        recoverableReadyState: {
          statusReady: task.status === "ready",
          markdownReady: task.runtime?.markdownReady ?? false,
          executionReady: task.runtime?.executionReady ?? null,
          sourceDisagreement: task.runtime?.sourceDisagreement ?? null,
          latestExecutionNotReadyPermitting:
            latestExecutionLog !== undefined &&
            latestExecutionLog.readyPermitting === false,
          liveClaimClear:
            latestExecutionLog !== undefined &&
            latestExecutionLog.claimState !== "active",
          locksClear: (latestExecutionLog?.lockCount ?? 0) === 0,
          branchLineageKnown: gitState.branchLineageKnown,
          resumeBlockedReasons: gitState.resumeBlockedReasons,
          resumeWarnings: gitState.resumeWarnings,
          forceRequired:
            gitState.resumeWarnings.length > 0 && options.force === undefined,
        },
      },
    );
  }
}

function createRecoveryHaltDetail(message: string, claimToken: string): {
  code: string;
  message: string;
  "x-recovery-claim": string;
} {
  return {
    code: "x-runtime-claim-halted",
    message,
    "x-recovery-claim": claimToken,
  };
}

export async function recoverTaskClaim(
  options: RecoverTaskClaimOptions,
): Promise<RecoverTaskClaimResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const consumerConfig =
    options.consumerConfig ?? ".doc-vader/backlog-consumer.json";
  const now = new Date();
  const task = await loadTaskModel(options.taskId, {
    rootDir,
    backlogDir: options.backlogDir,
  });
  const gitState = collectTaskRecoveryGitState({
    rootDir,
    taskFilePath: task.filePath,
    expectedBranch: options.branch ?? task.runtime?.latestExecutionLog?.branch,
    expectedWorktree: options.worktree ?? task.runtime?.latestExecutionLog?.worktree,
  });

  assertRecoverySafe(task);
  assertRecoverableStatus({ task, gitState, force: options.force });

  const changedPaths = gitState.dirtyPaths;
  const recoverableReadyRuntimeState = isRecoverableReadyRuntimeState({
    status: task.status,
    runtime: task.runtime,
    gitState,
    allowUncertainLineage: Boolean(options.force),
  });
  const haltedPathScope = loadLatestHaltedPathScope(rootDir, task.id);
  if (options.force && haltedPathScope) {
    const allowedPaths = new Set([
      ...haltedPathScope.dirtyPaths,
      ...haltedPathScope.unlockedPaths,
    ]);
    const unrelatedPaths = changedPaths
      .map((entry) => entry.path)
      .filter((entry) => !allowedPaths.has(entry));
    if (unrelatedPaths.length > 0) {
      throw new TaskCommandError(
        "TASK_RECOVERY_UNRELATED_DIRTY_PATHS",
        `Task '${task.id}' recovery cannot force unrelated dirty paths.`,
        {
          taskId: task.id,
          dirtyPaths: changedPaths,
          unrelatedPaths,
          haltedPathScope: {
            dirtyPaths: [...haltedPathScope.dirtyPaths],
            unlockedPaths: [...haltedPathScope.unlockedPaths],
          },
        },
      );
    }
  }
  if (
    changedPaths.length > 0 &&
    !options.force &&
    !recoverableReadyRuntimeState
  ) {
    throw new TaskCommandError(
      "TASK_RECOVERY_DIRTY_WORKTREE",
      `Task '${task.id}' recovery found local changes that may be overwritten.`,
      {
        taskId: task.id,
        dirtyPaths: changedPaths,
        forceModes: {
          reset: "Discard recoverable dirty paths before marking the task ready again.",
          reconcile: "Save a recovery checkpoint before discarding recoverable dirty paths.",
        },
        recommendation:
          "Commit, stash, or move unrelated work first. Use --force reset or --force reconcile only when the dirty paths belong to the interrupted task recovery.",
      },
    );
  }

  const branchPaths = collectRecoveryBranchPaths(rootDir);
  const initialLockPaths = [
    ...new Set([
      task.filePath,
      ...branchPaths,
      ...(recoverableReadyRuntimeState && !options.force
        ? []
        : changedPaths.map((entry) => entry.path)),
    ]),
  ];

  if (options.dryRun) {
    const transition = await transitionWorkItem({
      rootDir,
      consumerConfig,
      id: task.id,
      status: "ready",
      statusReason: "recoverable",
      dryRun: true,
    });
    return {
      taskId: task.id,
      dryRun: true,
      transition,
      plannedInitialLockPaths: initialLockPaths,
      dirtyPaths: changedPaths,
      gitState,
      ...(gitState.resumeWarnings.length > 0
        ? { warnings: gitState.resumeWarnings }
        : {}),
      ...(options.force === "reconcile"
        ? {
            plannedCheckpoint: {
              mode: options.force,
              directory: path.resolve(rootDir, RECOVERY_CHECKPOINT_DIR),
            },
          }
        : {}),
    };
  }

  const claimSeed = buildRecoveryClaimSeed({
    rootDir,
    taskId: task.id,
    holder: normalizeHolder(options.holder),
    branch: options.branch,
    worktree: options.worktree,
    now,
    ttlMinutes: options.ttlMinutes ?? DEFAULT_TTL_MINUTES,
  });

  const store = openRuntimeSqliteStore({ rootDir });
  try {
    const claimResult = store.acquireRuntimeClaim(claimSeed, {
      initialLockPaths,
    });

    if (claimResult.outcome !== "acquired") {
      throw new TaskCommandError(
        "TASK_RECOVERY_LOCK_CONFLICT",
        `Task '${task.id}' recovery could not acquire the required runtime locks.`,
        {
          taskId: task.id,
          claimToken: claimResult.claimToken,
          conflicts: claimResult.conflicts,
          executionLogEntry: claimResult.executionLogEntry,
        },
      );
    }

    let checkpoint: RecoverTaskClaimCheckpoint | undefined;
    try {
      if (options.force) {
        checkpoint = await prepareRecoveryCheckpoint({
          rootDir,
          taskId: task.id,
          claimToken: claimResult.claimToken,
          force: options.force,
          dirtyPaths: changedPaths,
        });
        restoreDirtyPaths(rootDir, changedPaths);
      }

      await transitionWorkItem({
        rootDir,
        consumerConfig,
        id: task.id,
        status: "ready",
        statusReason: "recoverable",
        dryRun: true,
      });

      const transitioned = await transitionWorkItem({
        rootDir,
        consumerConfig,
        id: task.id,
        status: "ready",
        statusReason: "recoverable",
      });

      const audit =
        recoverableReadyRuntimeState && !options.force
          ? store.auditClaimedPaths(claimResult.claimToken, [task.filePath])
          : runRuntimeClaimCoverageAudit({
              rootDir,
              taskId: task.id,
              requiredPaths: [task.filePath],
            });
      const auditPassed =
        recoverableReadyRuntimeState && !options.force
          ? audit.diagnostics.length === 0 && audit.renameDiagnostics.length === 0
          : audit.passed;
      if (!auditPassed) {
        throw new TaskCommandError(
          "TASK_RECOVERY_CHANGED_FILE_LOCK_AUDIT_FAILED",
          `Task '${task.id}' recovery failed the changed-file lock audit.`,
          {
            taskId: task.id,
            claimToken: claimResult.claimToken,
            audit,
          },
        );
      }

      const completed = store.completeRuntimeExecution(claimResult.claimToken);
      return {
        taskId: task.id,
        dryRun: false,
        claimToken: claimResult.claimToken,
        claim: claimResult.claim,
        executionLogEntry: completed.executionLogEntry,
        transition: transitioned,
        ...(gitState.resumeWarnings.length > 0
          ? { warnings: gitState.resumeWarnings }
          : {}),
        ...(checkpoint ? { checkpoint } : {}),
      };
    } catch (error) {
      try {
        await transitionWorkItem({
          rootDir,
          consumerConfig,
          id: task.id,
          status: task.status,
          statusReason: task.statusReason,
          dryRun: false,
        });
      } catch {
        // Best-effort rollback only.
      }
      try {
        store.haltRuntimeExecution(claimResult.claimToken, {
          reason: "invalid" as RuntimeExecutionHaltedReason,
          detail: createRecoveryHaltDetail(
            error instanceof Error ? error.message : String(error),
            claimResult.claimToken,
          ),
        });
      } catch {
        // Best-effort cleanup only.
      }
      throw error;
    }
  } finally {
    store.close();
  }
}
