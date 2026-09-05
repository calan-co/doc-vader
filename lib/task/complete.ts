import path from "node:path";
import type { RuntimeExecutionTerminalResult } from "../runtime/index.js";
import { transitionTask, type TaskTransitionResult } from "./transition.js";
import { getClaimStatus } from "./claims.js";
import { TaskCommandError } from "./errors.js";

export interface CompleteTaskClaimOptions {
  claimId: string;
  rootDir?: string;
  claimStorePath?: string;
  backlogDir?: string;
  consumerConfig?: string;
  dryRun?: boolean;
  actual?: number;
}

export interface CompleteTaskClaimResult {
  claimId: string;
  taskId: string;
  dryRun: boolean;
  transition: TaskTransitionResult;
  execution?: RuntimeExecutionTerminalResult;
}

export async function completeTaskClaim(
  options: CompleteTaskClaimOptions,
): Promise<CompleteTaskClaimResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const claim = await getClaimStatus(options.claimId, {
    rootDir,
    claimStorePath: options.claimStorePath,
  });
  if (claim.state !== "active" || !claim.taskId) {
    throw new TaskCommandError(
      "TASK_COMPLETE_INVALID_CLAIM",
      `Claim '${options.claimId}' is not active.`,
      { claimId: options.claimId, state: claim.state },
    );
  }
  const taskId = claim.taskId;

  const transition = await transitionTask({
    claimId: options.claimId,
    rootDir,
    claimStorePath: options.claimStorePath,
    backlogDir: options.backlogDir,
    consumerConfig: options.consumerConfig,
    status: "completed",
    statusReason: "completed",
    actual: options.actual,
    dryRun: options.dryRun,
  });

  if (options.dryRun) {
    return {
      claimId: options.claimId,
      taskId,
      dryRun: true,
      transition,
    };
  }

  return {
    claimId: options.claimId,
    taskId,
    dryRun: false,
    transition,
    execution: transition.workItem.execution,
  };
}
