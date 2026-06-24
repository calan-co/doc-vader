import { access } from "node:fs/promises";
import path from "node:path";
import {
  openRuntimeSqliteStore,
  type RuntimeExecutionLogRecord,
  type RuntimeExecutionReason,
  type RuntimeExecutionState,
} from "../runtime/index.js";

export interface TaskRuntimeExecutionLog {
  claimToken: string;
  targetType: string;
  targetId: string;
  state: RuntimeExecutionState;
  reason: RuntimeExecutionReason;
  createdAt: string;
  readyPermitting: boolean;
  claimState?: "active" | "expired" | "missing";
  lockCount?: number;
  branch?: string;
  worktree?: string;
}

export interface TaskRuntimeReadiness {
  markdownReady: boolean;
  executionReady: boolean;
  ready: boolean;
  sourceDisagreement: boolean;
  latestExecutionLog?: TaskRuntimeExecutionLog;
}

function toExecutionSummary(
  entry: RuntimeExecutionLogRecord,
  options: {
    claimState?: "active" | "expired" | "missing";
    lockCount?: number;
    branch?: string;
    worktree?: string;
  } = {},
): TaskRuntimeExecutionLog {
  return {
    claimToken: entry.claim_token,
    targetType: entry.target_type,
    targetId: entry.target_id,
    state: entry.state,
    reason: entry.reason,
    createdAt: entry.created_at,
    readyPermitting: entry.state === "completed" && entry.reason === "success",
    ...(options.claimState ? { claimState: options.claimState } : {}),
    ...(options.lockCount !== undefined ? { lockCount: options.lockCount } : {}),
    ...(options.branch ? { branch: options.branch } : {}),
    ...(options.worktree ? { worktree: options.worktree } : {}),
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

export async function loadTaskExecutionLogSummaries(options: {
  rootDir?: string;
  taskIds?: Iterable<string>;
} = {}): Promise<Map<string, TaskRuntimeExecutionLog>> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const runtimeDatabasePath = path.resolve(
    rootDir,
    ".doc-vader",
    "runtime",
    "runtime.sqlite",
  );
  try {
    await access(runtimeDatabasePath);
  } catch {
    return new Map();
  }
  const taskIds = options.taskIds ? new Set(options.taskIds) : undefined;
  const store = openRuntimeSqliteStore({ rootDir });
  try {
    const summaries = new Map<string, RuntimeExecutionLogRecord>();
    for (const entry of store.listExecutionLogEntries()) {
      if (entry.target_type !== "task") {
        continue;
      }
      if (taskIds && !taskIds.has(entry.target_id)) {
        continue;
      }
      const current = summaries.get(entry.target_id);
      if (
        !current ||
        entry.created_at > current.created_at ||
        (entry.created_at === current.created_at && entry.id > current.id)
      ) {
        summaries.set(entry.target_id, entry);
      }
    }

    return new Map(
      [...summaries.entries()].map(([taskId, entry]) => {
        const claim = store.getClaimByToken(entry.claim_token);
        const locks = store.listLocksByClaimToken(entry.claim_token);
        return [
          taskId,
          toExecutionSummary(entry, {
            claimState: claim?.state ?? "missing",
            lockCount: locks.length,
            branch: claimMetadataString(claim?.metadata, "branch"),
            worktree: claimMetadataString(claim?.metadata, "worktree"),
          }),
        ];
      }),
    );
  } finally {
    store.close();
  }
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
