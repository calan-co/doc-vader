import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createRecord,
  linkWorkItem,
  loadConsumerConfig,
  resolveWorkItemFile,
  runRuntimeClaimCoverageAudit,
  type CreateRecordOptions,
  type CreateRecordResult,
} from "../work-management/index.js";
import {
  loadClaimAuthorityClaimByTarget,
  loadClaimAuthoritySubjects,
} from "../claim/index.js";
import { getClaimStatus } from "./claims.js";
import { TaskCommandError } from "./errors.js";

export interface RecordPayload {
  id?: string;
  summary: string;
  observation: string;
  subject?: string;
  subjects?: string[];
  outcome?: string;
  recordedAt?: string;
  artifactRefs?: string[];
  supportingRefs?: string[];
  findings?: string[];
  notes?: string[];
}

export type TaskRecordPayload = RecordPayload;

export interface TaskRecordResult {
  claimId: string;
  taskId: string;
  record: CreateRecordResult;
  evidenceLink: string;
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

function optionalStringArray(
  payload: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const value = payload[field];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new TaskCommandError(
      "TASK_RECORD_INVALID_PAYLOAD",
      `Payload field '${field}' must be an array of non-empty strings.`,
      { field },
    );
  }
  const normalized = value.map((entry) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new TaskCommandError(
        "TASK_RECORD_INVALID_PAYLOAD",
        `Payload field '${field}' must be an array of non-empty strings.`,
        { field },
      );
    }
    return entry.trim();
  });
  return normalized;
}

function normalizeSubjects(
  payload: Record<string, unknown>,
): string[] | undefined {
  const subjects = new Set<string>();
  const subject = optionalString(payload, "subject");
  if (subject) {
    subjects.add(subject);
  }
  for (const entry of optionalStringArray(payload, "subjects") ?? []) {
    subjects.add(entry);
  }
  return subjects.size > 0 ? [...subjects] : undefined;
}

export function validateRecordPayload(value: unknown): RecordPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TaskCommandError(
      "TASK_RECORD_INVALID_PAYLOAD",
      "Record payload must be a JSON object.",
    );
  }
  const payload = value as Record<string, unknown>;
  const allowedFields = new Set([
    "id",
    "summary",
    "observation",
    "subject",
    "subjects",
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

  return {
    id: optionalString(payload, "id"),
    summary: requireString(payload, "summary"),
    observation: requireString(payload, "observation"),
    subject: optionalString(payload, "subject"),
    subjects: normalizeSubjects(payload),
    outcome: optionalString(payload, "outcome"),
    recordedAt: optionalString(payload, "recordedAt"),
    artifactRefs: optionalStringArray(payload, "artifactRefs"),
    supportingRefs: optionalStringArray(payload, "supportingRefs"),
    findings: optionalStringArray(payload, "findings"),
    notes: optionalStringArray(payload, "notes"),
  };
}

export const validateTaskRecordPayload = validateRecordPayload;

export async function readRecordPayload(
  payloadPath: string,
  stdin?: NodeJS.ReadStream,
): Promise<RecordPayload> {
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
    return validateRecordPayload(JSON.parse(raw));
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

export const readTaskRecordPayload = readRecordPayload;

function resolveSubjects(
  payload: RecordPayload,
  additionalSubjects: string[] = [],
): string[] {
  const subjects = new Set<string>(additionalSubjects.filter(Boolean));
  if (payload.subject?.trim()) {
    subjects.add(payload.subject.trim());
  }
  for (const subject of payload.subjects ?? []) {
    if (subject.trim().length > 0) {
      subjects.add(subject.trim());
    }
  }
  return [...subjects];
}

function buildCreateRecordOptions(options: {
  payload: TaskRecordPayload;
  type?: string;
  consumerConfig?: string;
  claimToken?: string;
  dryRun?: boolean;
  subjects: string[];
}): CreateRecordOptions {
  return {
    id: options.payload.id,
    summary: options.payload.summary,
    observation: options.payload.observation,
    subjects: options.subjects,
    subtype: options.type ?? "test-result",
    outcome: options.payload.outcome,
    recordedAt: options.payload.recordedAt,
    artifactRefs: options.payload.artifactRefs,
    supportingRefs: options.payload.supportingRefs,
    findings: options.payload.findings,
    notes: options.payload.notes,
    consumerConfig: options.consumerConfig,
    claimToken: options.claimToken,
    dryRun: options.dryRun,
  };
}

function resolveRuntimeRecordSubjects(options: {
  rootDir: string;
  claimToken: string;
}): string[] {
  return loadClaimAuthoritySubjects(options);
}

export async function recordTaskEvidence(options: {
  claimId: string;
  type?: string;
  payload: TaskRecordPayload;
  rootDir?: string;
  claimStorePath?: string;
  consumerConfig?: string;
  dryRun?: boolean;
}): Promise<TaskRecordResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const consumerConfig = options.consumerConfig ?? ".doc-vader/backlog-consumer.json";
  const claim = await getClaimStatus(options.claimId, {
    rootDir,
    claimStorePath: options.claimStorePath,
  });
  if (claim.state !== "active" || !claim.taskId) {
    throw new TaskCommandError(
      "TASK_RECORD_INVALID_CLAIM",
      `Claim '${options.claimId}' is not active.`,
      { claimId: options.claimId, state: claim.state },
    );
  }

  const runtimeClaimToken =
    loadClaimAuthorityClaimByTarget({
      rootDir,
      targetType: "task",
      targetId: claim.taskId,
    })?.claim_token ?? options.claimId;

  // Reserve the Work Item path for the eventual evidence link without creating
  // a placeholder relationship that could leak into durable frontmatter.
  const workItemPath = await resolveWorkItemFile(
    rootDir,
    await loadConsumerConfig(rootDir, consumerConfig),
    claim.taskId,
  );

  const recordOptions = buildCreateRecordOptions({
    payload: options.payload,
    type: options.type,
    consumerConfig,
    claimToken: runtimeClaimToken,
    subjects: resolveSubjects(options.payload, [
      claim.taskId,
      ...resolveRuntimeRecordSubjects({
        rootDir,
        claimToken: runtimeClaimToken,
      }),
    ]),
  });

  const recordPreflight = await createRecord({
    rootDir,
    ...recordOptions,
    dryRun: true,
  });

  const runtimeAudit = await runRuntimeClaimCoverageAudit({
    rootDir,
    taskId: claim.taskId,
    claimToken: runtimeClaimToken,
    requiredPaths: [recordPreflight.filePath, workItemPath],
  });
  if (!runtimeAudit.passed) {
    throw new TaskCommandError(
      "TASK_RECORD_CHANGED_FILE_LOCK_AUDIT_FAILED",
      `Task '${claim.taskId}' record coverage failed changed-file lock audit.`,
      { claimId: options.claimId, audit: runtimeAudit },
    );
  }

  const record = await createRecord({
    rootDir,
    ...recordOptions,
    dryRun: options.dryRun,
  });
  const evidenceLink = `[[${path.basename(record.filePath, ".md")}]]`;
  await linkWorkItem({
    rootDir,
    consumerConfig,
    id: claim.taskId,
    kind: "evidence",
    value: evidenceLink,
    claimToken: runtimeClaimToken,
    dryRun: options.dryRun,
  });
  return {
    claimId: options.claimId,
    taskId: claim.taskId,
    record,
    evidenceLink,
  };
}
