import { TaskCommandError } from "./errors.js";
import type { TaskRuntimeReadiness } from "./runtime.js";

export type TaskClaimabilityFailure =
  | "not-active"
  | "not-ready"
  | "not-afk"
  | "hitl"
  | "dependencies-not-satisfied"
  | "execution-not-ready";

export interface TaskClaimabilityInput {
  id: string;
  validation: {
    isActive: boolean;
    isReady: boolean;
    isAfk: boolean;
    isHitl: boolean;
    dependenciesSatisfied: boolean;
  };
  runtime?: TaskRuntimeReadiness;
}

export interface TaskClaimabilityResult {
  claimable: boolean;
  failures: TaskClaimabilityFailure[];
}

export function evaluateTaskClaimability(
  task: TaskClaimabilityInput,
): TaskClaimabilityResult {
  const failures: TaskClaimabilityFailure[] = [];
  if (!task.validation.isActive) failures.push("not-active");
  if (!task.validation.isReady) failures.push("not-ready");
  if (!task.validation.isAfk) failures.push("not-afk");
  if (task.validation.isHitl) failures.push("hitl");
  if (!task.validation.dependenciesSatisfied) {
    failures.push("dependencies-not-satisfied");
  }
  if (task.runtime?.executionReady !== true) {
    failures.push("execution-not-ready");
  }

  return {
    claimable: failures.length === 0,
    failures,
  };
}

export function assertTaskClaimable(task: TaskClaimabilityInput): void {
  const claimability = evaluateTaskClaimability(task);
  if (claimability.claimable) {
    return;
  }

  throw new TaskCommandError(
    "TASK_NOT_CLAIMABLE",
    `Task '${task.id}' is not eligible for a local claim.`,
    { taskId: task.id, failures: claimability.failures },
  );
}
