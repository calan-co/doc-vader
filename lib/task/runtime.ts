import {
  readRuntimeClaimTaskExecutionSummaries,
  type RuntimeClaimExecutionFact,
  type RuntimeClaimTaskExecutionSummary,
} from "../runtime-claim/index.js";

export interface TaskRuntimeExecutionLog {
  claimToken: string;
  targetType: string;
  targetId: string;
  state: RuntimeClaimExecutionFact["state"];
  reason: RuntimeClaimExecutionFact["reason"];
  createdAt: string;
  readyPermitting: boolean;
  claimState?: "active" | "expired" | "missing";
  lockCount?: number;
  branch?: string;
  worktree?: string;
  worktreeMetadataInvalid?: boolean;
}

export interface TaskRuntimeReadiness {
  markdownReady: boolean;
  executionReady: boolean;
  ready: boolean;
  sourceDisagreement: boolean;
  latestExecutionLog?: TaskRuntimeExecutionLog;
}

function toExecutionSummary(
  entry: RuntimeClaimExecutionFact,
  options: {
    claimState?: "active" | "expired" | "missing";
    lockCount?: number;
    branch?: string;
    worktree?: string;
    worktreeMetadataInvalid?: boolean;
  } = {},
): TaskRuntimeExecutionLog {
  return {
    claimToken: entry.claimToken,
    targetType: entry.targetType,
    targetId: entry.targetId,
    state: entry.state,
    reason: entry.reason,
    createdAt: entry.createdAt,
    readyPermitting: entry.state === "completed" && entry.reason === "success",
    ...(options.claimState ? { claimState: options.claimState } : {}),
    ...(options.lockCount !== undefined ? { lockCount: options.lockCount } : {}),
    ...(options.branch ? { branch: options.branch } : {}),
    ...(options.worktree ? { worktree: options.worktree } : {}),
    ...(options.worktreeMetadataInvalid ? { worktreeMetadataInvalid: true } : {}),
  };
}

function claimMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function hasInvalidWorktreeMetadata(
  metadata: Record<string, unknown> | undefined,
): boolean {
  return (
    metadata !== undefined &&
    Object.hasOwn(metadata, "worktree") &&
    !claimMetadataString(metadata, "worktree")
  );
}

export async function loadTaskExecutionLogSummaries(options: {
  rootDir?: string;
  taskIds?: Iterable<string>;
} = {}): Promise<Map<string, TaskRuntimeExecutionLog>> {
  const summaries = readRuntimeClaimTaskExecutionSummaries(options);
  return new Map(
    [...summaries.entries()].map(([taskId, summary]: [string, RuntimeClaimTaskExecutionSummary]) => [
      taskId,
      toExecutionSummary(summary.execution, {
        claimState: summary.claim?.state ?? "missing",
        lockCount: summary.activeLockCount,
        branch: claimMetadataString(summary.claim?.metadata, "branch"),
        worktree: claimMetadataString(summary.claim?.metadata, "worktree"),
        worktreeMetadataInvalid: hasInvalidWorktreeMetadata(summary.claim?.metadata),
      }),
    ]),
  );
}

export async function loadTaskRuntimeReadiness(options: {
  rootDir?: string;
  taskId: string;
  markdownReady: boolean;
}): Promise<TaskRuntimeReadiness> {
  const runtimeSummaries = await loadTaskExecutionLogSummaries({
    rootDir: options.rootDir,
    taskIds: [options.taskId],
  });
  return composeTaskRuntimeReadiness(
    options.markdownReady,
    runtimeSummaries.get(options.taskId),
  );
}

export function composeTaskRuntimeReadiness(
  markdownReady: boolean,
  latestExecutionLog?: TaskRuntimeExecutionLog,
): TaskRuntimeReadiness {
  const executionReady = latestExecutionLog
    ? latestExecutionLog.readyPermitting
    : true;

  return {
    markdownReady,
    executionReady,
    ready: markdownReady && executionReady,
    sourceDisagreement: latestExecutionLog
      ? markdownReady !== executionReady
      : false,
    ...(latestExecutionLog ? { latestExecutionLog } : {}),
  };
}
