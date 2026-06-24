import matter from "gray-matter";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  transitionWorkItem,
  runRuntimeClaimCoverageAudit,
  type TransitionWorkItemResult,
} from "../work-management/index.js";
import { evaluateTransition } from "../work-management/frontmatter-lint.js";
import { getClaimStatus } from "./claims.js";
import { TaskCommandError } from "./errors.js";
import { loadTaskModel } from "./model.js";

export interface TaskTransitionPayload {
  fromStatus?: string;
  from_status?: string;
  toStatus?: string;
  to_status?: string;
  status?: string;
  statusReason?: string;
  to_status_reason?: string;
  reason?: string;
  actual?: number;
  assignee?: string;
  completedDate?: string;
  completed_date?: string;
}

export interface TaskTransitionOptions {
  claimId: string;
  status: string;
  expectedFromStatus?: string;
  statusReason?: string;
  actual?: number;
  assignee?: string;
  completedDate?: string;
  rootDir?: string;
  claimStorePath?: string;
  backlogDir?: string;
  consumerConfig?: string;
  dryRun?: boolean;
}

export interface TaskTransitionResult {
  claimId: string;
  taskId: string;
  fromStatus: string;
  toStatus: string;
  matchedRuleId: string | null;
  workItem: TransitionWorkItemResult;
}

function normalizeString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TaskCommandError(
      "TASK_TRANSITION_INVALID_PAYLOAD",
      `Payload field '${field}' must be a non-empty string.`,
      { field },
    );
  }
  return value.trim();
}

function normalizeNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TaskCommandError(
      "TASK_TRANSITION_INVALID_PAYLOAD",
      `Payload field '${field}' must be a finite number.`,
      { field },
    );
  }
  return value;
}

export function validateTaskTransitionPayload(
  value: unknown,
): TaskTransitionPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TaskCommandError(
      "TASK_TRANSITION_INVALID_PAYLOAD",
      "Task transition payload must be a JSON object.",
    );
  }
  const payload = value as Record<string, unknown>;
  const allowedFields = new Set([
    "fromStatus",
    "from_status",
    "toStatus",
    "to_status",
    "status",
    "statusReason",
    "to_status_reason",
    "reason",
    "actual",
    "assignee",
    "completedDate",
    "completed_date",
  ]);
  const unknownFields = Object.keys(payload).filter(
    (field) => !allowedFields.has(field),
  );
  if (unknownFields.length > 0) {
    throw new TaskCommandError(
      "TASK_TRANSITION_INVALID_PAYLOAD",
      `Payload contains unsupported field(s): ${unknownFields.join(", ")}.`,
      { fields: unknownFields },
    );
  }
  return {
    fromStatus: normalizeString(payload.fromStatus, "fromStatus"),
    from_status: normalizeString(payload.from_status, "from_status"),
    toStatus: normalizeString(payload.toStatus, "toStatus"),
    to_status: normalizeString(payload.to_status, "to_status"),
    status: normalizeString(payload.status, "status"),
    statusReason: normalizeString(payload.statusReason, "statusReason"),
    to_status_reason: normalizeString(
      payload.to_status_reason,
      "to_status_reason",
    ),
    reason: normalizeString(payload.reason, "reason"),
    actual: normalizeNumber(payload.actual, "actual"),
    assignee: normalizeString(payload.assignee, "assignee"),
    completedDate: normalizeString(payload.completedDate, "completedDate"),
    completed_date: normalizeString(payload.completed_date, "completed_date"),
  };
}

export async function readTaskTransitionPayload(
  payloadPath: string,
  stdin?: NodeJS.ReadStream,
): Promise<TaskTransitionPayload> {
  const raw =
    payloadPath === "-"
      ? await new Promise<string>((resolve, reject) => {
          let buffer = "";
          const input = stdin ?? process.stdin;
          input.setEncoding("utf8");
          input.on("data", (chunk) => {
            buffer += chunk;
          });
          input.on("end", () => resolve(buffer));
          input.on("error", reject);
        })
      : await fs.readFile(path.resolve(payloadPath), "utf8");
  try {
    return validateTaskTransitionPayload(JSON.parse(raw));
  } catch (error) {
    if (error instanceof TaskCommandError) {
      throw error;
    }
    throw new TaskCommandError(
      "TASK_TRANSITION_INVALID_PAYLOAD",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function defaultStatusReason(status: string): string | undefined {
  switch (status) {
    case "draft":
      return "needs-triage";
    case "ready":
      return "auto";
    case "running":
      return "implementation";
    case "paused":
      return "blocked";
    case "completed":
      return "completed";
    case "aborted":
      return "cancelled";
    default:
      return undefined;
  }
}

function normalizeStatus(value: string): string {
  const status = value.trim().toLowerCase();
  if (!status) {
    throw new TaskCommandError(
      "TASK_TRANSITION_INVALID_TARGET",
      "Transition target status is required.",
    );
  }
  return status;
}

async function assertCompletedHasEvidence(
  rootDir: string,
  relativeFilePath: string,
): Promise<void> {
  const raw = await fs.readFile(path.resolve(rootDir, relativeFilePath), "utf8");
  const parsed = matter(raw);
  const evidence = parsed.data?.links?.evidence;
  if (
    !Array.isArray(evidence) ||
    !evidence.some((entry) => typeof entry === "string" && entry.trim())
  ) {
    throw new TaskCommandError(
      "TASK_TRANSITION_MISSING_EVIDENCE",
      "Task completion requires at least one linked evidence record.",
      { path: relativeFilePath },
    );
  }
}

async function applyTaskTransition(options: {
  task: Awaited<ReturnType<typeof loadTaskModel>>;
  rootDir: string;
  consumerConfig: string;
  status: string;
  expectedFromStatus?: string;
  statusReason?: string;
  actual?: number;
  assignee?: string;
  completedDate?: string;
  dryRun?: boolean;
}): Promise<Omit<TaskTransitionResult, "claimId">> {
  const toStatus = normalizeStatus(options.status);
  const fromStatus = normalizeStatus(options.task.status);
  if (
    options.expectedFromStatus &&
    normalizeStatus(options.expectedFromStatus) !== fromStatus
  ) {
    throw new TaskCommandError(
      "TASK_TRANSITION_FROM_STATUS_MISMATCH",
      `Expected from status '${options.expectedFromStatus}' does not match current status '${fromStatus}'.`,
      { expectedFromStatus: options.expectedFromStatus, currentStatus: fromStatus },
    );
  }
  const toStatusReason =
    options.statusReason?.trim() ?? defaultStatusReason(toStatus);
  const previous = {
    status: fromStatus,
    status_reason:
      options.task.statusReason ?? defaultStatusReason(fromStatus) ?? null,
  };
  const current = {
    status: toStatus,
    status_reason: toStatusReason ?? null,
  };

  let evaluation: ReturnType<typeof evaluateTransition>;
  try {
    evaluation = evaluateTransition(previous, current);
  } catch (error) {
    throw new TaskCommandError(
      "TASK_TRANSITION_INVALID_TARGET",
      error instanceof Error ? error.message : String(error),
      { fromStatus, toStatus, toStatusReason },
    );
  }
  if (!evaluation.allowed) {
    throw new TaskCommandError(
      "TASK_TRANSITION_DISALLOWED",
      `Transition from '${fromStatus}' to '${toStatus}' is not allowed by the work-management profile.`,
      { fromStatus, toStatus, toStatusReason },
    );
  }

  if (toStatus === "completed") {
    await assertCompletedHasEvidence(options.rootDir, options.task.filePath);
    const audit = runRuntimeClaimCoverageAudit({
      rootDir: options.rootDir,
      taskId: options.task.id,
      requiredPaths: [options.task.filePath],
    });
    if (!audit.passed) {
      throw new TaskCommandError(
        "TASK_TRANSITION_CHANGED_FILE_LOCK_AUDIT_FAILED",
        `Task '${options.task.id}' cannot transition to completed until changed-file lock coverage passes.`,
        { taskId: options.task.id, audit },
      );
    }
  }

  const workItem = await transitionWorkItem({
    rootDir: options.rootDir,
    consumerConfig: options.consumerConfig,
    id: options.task.id,
    status: toStatus,
    statusReason: toStatusReason,
    actual: options.actual,
    assignee: options.assignee,
    completedDate: options.completedDate,
    dryRun: options.dryRun,
  });

  return {
    taskId: options.task.id,
    fromStatus,
    toStatus,
    matchedRuleId: evaluation.matchedRuleId,
    workItem,
  };
}

export function optionsFromTransitionPayload(
  payload: TaskTransitionPayload,
): Omit<TaskTransitionOptions, "claimId"> {
  const status = payload.toStatus ?? payload.to_status ?? payload.status;
  if (!status) {
    throw new TaskCommandError(
      "TASK_TRANSITION_INVALID_PAYLOAD",
      "Payload must include 'toStatus', 'to_status', or 'status'.",
    );
  }
  return {
    status,
    expectedFromStatus: payload.fromStatus ?? payload.from_status,
    statusReason:
      payload.statusReason ?? payload.to_status_reason ?? payload.reason,
    actual: payload.actual,
    assignee: payload.assignee,
    completedDate: payload.completedDate ?? payload.completed_date,
  };
}

export async function transitionTask(
  options: TaskTransitionOptions,
): Promise<TaskTransitionResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const consumerConfig = options.consumerConfig ?? ".doc-vader/backlog-consumer.json";
  const claim = await getClaimStatus(options.claimId, {
    rootDir,
    claimStorePath: options.claimStorePath,
  });
  if (claim.state !== "active" || !claim.taskId) {
    throw new TaskCommandError(
      "TASK_TRANSITION_INVALID_CLAIM",
      `Claim '${options.claimId}' is not active.`,
      { claimId: options.claimId, state: claim.state },
    );
  }

  const task = await loadTaskModel(claim.taskId, {
    rootDir,
    backlogDir: options.backlogDir,
  });
  if (task.id !== claim.taskId) {
    throw new TaskCommandError(
      "TASK_TRANSITION_CLAIM_MISMATCH",
      `Claim '${options.claimId}' resolved to a different task.`,
      { claimId: options.claimId, claimTaskId: claim.taskId, taskId: task.id },
    );
  }

  const result = await applyTaskTransition({
    task,
    rootDir,
    consumerConfig,
    status: options.status,
    expectedFromStatus: options.expectedFromStatus,
    statusReason: options.statusReason,
    actual: options.actual,
    assignee: options.assignee,
    completedDate: options.completedDate,
    dryRun: options.dryRun,
  });

  return {
    claimId: options.claimId,
    ...result,
  };
}
