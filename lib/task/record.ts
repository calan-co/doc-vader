import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createRecord,
  linkWorkItem,
  type CreateRecordResult,
} from "../work-management/index.js";
import { getClaimStatus } from "./claims.js";
import { TaskCommandError } from "./errors.js";

export interface TaskRecordPayload {
  id?: string;
  type: string;
  subtype?: string;
  summary: string;
  observation: string;
  outcome?: string;
  recordedAt?: string;
  artifactRefs?: string[];
  supportingRefs?: string[];
  findings?: string[];
  notes?: string[];
}

export interface TaskRecordResult {
  claimId: string;
  taskId: string;
  record: CreateRecordResult;
  evidenceLink: string;
}

function asStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    !value.every(
      (entry) => typeof entry === "string" && entry.trim().length > 0,
    )
  ) {
    throw new TaskCommandError(
      "TASK_RECORD_INVALID_PAYLOAD",
      `Payload field '${field}' must be an array of non-empty strings.`,
      { field },
    );
  }
  return value.map((entry) => entry.trim());
}

function requireString(
  payload: Record<string, unknown>,
  field: string,
): string {
  const value = payload[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TaskCommandError(
      "TASK_RECORD_INVALID_PAYLOAD",
      `Payload field '${field}' is required.`,
      { field },
    );
  }
  return value.trim();
}

function optionalString(
  payload: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = payload[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TaskCommandError(
      "TASK_RECORD_INVALID_PAYLOAD",
      `Payload field '${field}' must be a non-empty string.`,
      { field },
    );
  }
  return value.trim();
}

export function validateTaskRecordPayload(value: unknown): TaskRecordPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TaskCommandError(
      "TASK_RECORD_INVALID_PAYLOAD",
      "Task record payload must be a JSON object.",
    );
  }
  const payload = value as Record<string, unknown>;
  const allowedFields = new Set([
    "id",
    "type",
    "subtype",
    "summary",
    "observation",
    "outcome",
    "recordedAt",
    "artifactRefs",
    "supportingRefs",
    "findings",
    "notes",
  ]);
  const unknownFields = Object.keys(payload).filter(
    (field) => !allowedFields.has(field),
  );
  if (unknownFields.length > 0) {
    throw new TaskCommandError(
      "TASK_RECORD_INVALID_PAYLOAD",
      `Payload contains unsupported field(s): ${unknownFields.join(", ")}.`,
      { fields: unknownFields },
    );
  }

  const type = requireString(payload, "type");
  const subtype = optionalString(payload, "subtype") ?? type;
  return {
    id: optionalString(payload, "id"),
    type,
    subtype,
    summary: requireString(payload, "summary"),
    observation: requireString(payload, "observation"),
    outcome: optionalString(payload, "outcome"),
    recordedAt: optionalString(payload, "recordedAt"),
    artifactRefs: asStringArray(payload.artifactRefs, "artifactRefs"),
    supportingRefs: asStringArray(payload.supportingRefs, "supportingRefs"),
    findings: asStringArray(payload.findings, "findings"),
    notes: asStringArray(payload.notes, "notes"),
  };
}

export async function readTaskRecordPayload(
  payloadPath: string,
  stdin?: NodeJS.ReadStream,
): Promise<TaskRecordPayload> {
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
    return validateTaskRecordPayload(JSON.parse(raw));
  } catch (error) {
    if (error instanceof TaskCommandError) {
      throw error;
    }
    throw new TaskCommandError(
      "TASK_RECORD_INVALID_PAYLOAD",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function recordTaskEvidence(options: {
  claimId: string;
  payload: TaskRecordPayload;
  rootDir?: string;
  consumerConfig?: string;
  dryRun?: boolean;
}): Promise<TaskRecordResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const consumerConfig = options.consumerConfig ?? ".doc-vader/backlog-consumer.json";
  const claim = await getClaimStatus(options.claimId, { rootDir });
  if (claim.state !== "active" || !claim.taskId) {
    throw new TaskCommandError(
      "TASK_RECORD_INVALID_CLAIM",
      `Claim '${options.claimId}' is not active.`,
      { claimId: options.claimId, state: claim.state },
    );
  }

  await linkWorkItem({
    rootDir,
    consumerConfig,
    id: claim.taskId,
    kind: "evidence",
    value: "[[task-record-preflight]]",
    dryRun: true,
  });

  const record = await createRecord({
    rootDir,
    consumerConfig,
    id: options.payload.id,
    summary: options.payload.summary,
    observation: options.payload.observation,
    subjects: [claim.taskId],
    subtype: options.payload.subtype,
    outcome: options.payload.outcome,
    recordedAt: options.payload.recordedAt,
    artifactRefs: options.payload.artifactRefs,
    supportingRefs: options.payload.supportingRefs,
    findings: options.payload.findings,
    notes: options.payload.notes,
    dryRun: options.dryRun,
  });
  const evidenceLink = `[[${path.basename(record.filePath, ".md")}]]`;
  await linkWorkItem({
    rootDir,
    consumerConfig,
    id: claim.taskId,
    kind: "evidence",
    value: evidenceLink,
    dryRun: options.dryRun,
  });
  return {
    claimId: options.claimId,
    taskId: claim.taskId,
    record,
    evidenceLink,
  };
}
