import { execFileSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import {
  createRecord,
  linkWorkItem,
  loadConsumerConfig,
  runRuntimeClaimCoverageAudit,
  type CreateRecordOptions,
  type CreateRecordResult,
} from "../work-management/index.js";
import { loadTaskModel } from "./model.js";
import { openRuntimeSqliteStore } from "../runtime/index.js";
import { canonicalizeClaimScopeRef } from "../runtime/scope-locks.js";
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

export interface HistoricalEvidenceContext {
  pr: string;
  commit: string;
  publishedRef: string;
  changedFiles: string[];
}

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

function git(rootDir: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: rootDir, encoding: "utf8" }).trim();
  } catch (error) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_EVIDENCE_GIT_VERIFICATION_FAILED",
      `Unable to verify historical evidence with git ${args.join(" ")}.`,
      { args, error: error instanceof Error ? error.message : String(error) },
    );
  }
}

function historicalPath(value: string): string {
  if (!value || value.startsWith("/") || value.split("/").includes("..")) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_EVIDENCE_INVALID_CHANGED_FILE",
      `Historical changed file '${value}' must be a repository-relative path.`,
      { path: value },
    );
  }
  return value;
}

async function verifyHistoricalEvidenceContext(options: {
  rootDir: string;
  taskId: string;
  consumerConfig: string;
  context: HistoricalEvidenceContext;
}): Promise<HistoricalEvidenceContext> {
  const { context } = options;
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(context.pr)) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_EVIDENCE_INVALID_PR",
      "Historical evidence requires an immutable GitHub pull request URL.",
      { pr: context.pr },
    );
  }
  const config = await loadConsumerConfig(options.rootDir, options.consumerConfig);
  const task = await loadTaskModel(options.taskId, {
    rootDir: options.rootDir,
    backlogDir: config.roots.backlog,
  });
  const rawTask = matter(
    await fs.readFile(path.resolve(options.rootDir, task.filePath), "utf8"),
  );
  if (!Array.isArray(rawTask.data?.links?.pull_requests) || !rawTask.data.links.pull_requests.includes(context.pr)) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_EVIDENCE_PR_NOT_LINKED",
      `PR '${context.pr}' is not linked to task '${task.id}'.`,
      { taskId: task.id, pr: context.pr },
    );
  }
  const commit = git(options.rootDir, ["rev-parse", "--verify", `${context.commit}^{commit}`]);
  const publishedRef = git(options.rootDir, ["rev-parse", "--verify", `${context.publishedRef}^{commit}`]);
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, publishedRef], {
      cwd: options.rootDir,
      stdio: "ignore",
    });
  } catch {
    throw new TaskCommandError(
      "TASK_HISTORICAL_EVIDENCE_COMMIT_NOT_PUBLISHED",
      `Commit '${commit}' is not an ancestor of published ref '${context.publishedRef}'.`,
      { commit, publishedRef: context.publishedRef },
    );
  }
  const commits = rawTask.data?.commits;
  if (
    typeof commits !== "object" || commits === null || Array.isArray(commits) ||
    !Object.keys(commits as Record<string, unknown>).some(
      (sha) => /^[0-9a-f]{7,40}$/i.test(sha) && commit.startsWith(sha.toLowerCase()),
    )
  ) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_EVIDENCE_COMMIT_NOT_LINKED",
      `Commit '${commit}' is not linked to task '${task.id}'.`,
      { taskId: task.id, commit },
    );
  }
  const parent = git(options.rootDir, ["rev-parse", "--verify", `${commit}^1`]);
  const diff = execFileSync(
    "git",
    ["diff", "--name-status", "--find-renames", "-z", parent, commit],
    { cwd: options.rootDir, encoding: "utf8" },
  ).split("\0").filter(Boolean);
  const changedFiles = new Set<string>();
  for (let index = 0; index < diff.length;) {
    const status = diff[index++]!;
    if (status.startsWith("R") || status.startsWith("C")) {
      throw new TaskCommandError(
        "TASK_HISTORICAL_EVIDENCE_RENAME_NOT_SUPPORTED",
        "Historical evidence rejects renamed or copied files.",
        { status },
      );
    }
    changedFiles.add(historicalPath(diff[index++] ?? ""));
  }
  const attributed = new Set(context.changedFiles.map(historicalPath));
  if (
    changedFiles.size !== attributed.size ||
    [...changedFiles].some((filePath) => !attributed.has(filePath))
  ) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_EVIDENCE_UNATTRIBUTED_CHANGED_FILE",
      "Historical evidence requires the exact verified changed-file manifest.",
      { changedFiles: [...changedFiles], attributedFiles: [...attributed] },
    );
  }
  return { pr: context.pr, commit, publishedRef, changedFiles: [...changedFiles].sort() };
}

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
    dryRun: options.dryRun,
  };
}

function resolveRuntimeRecordSubjects(options: {
  rootDir: string;
  claimToken: string;
}): string[] {
  const runtimeDatabasePath = path.resolve(
    options.rootDir,
    ".doc-vader",
    "runtime",
    "runtime.sqlite",
  );
  if (!existsSync(runtimeDatabasePath)) {
    return [];
  }

  const store = openRuntimeSqliteStore({ rootDir: options.rootDir });
  try {
    const runtimeClaim = store.getClaimByToken(options.claimToken);
    if (!runtimeClaim) {
      return [];
    }

    const subjects = new Set<string>([
      `claim:${runtimeClaim.claim_token}`,
      canonicalizeClaimScopeRef(
        runtimeClaim.target_type,
        runtimeClaim.target_id,
      ),
    ]);
    for (const scopeLock of store.listScopeLocksByClaimToken(
      options.claimToken,
    )) {
      if (scopeLock.lifecycle_state === "active") {
        subjects.add(scopeLock.scope_ref);
      }
    }
    return [...subjects];
  } finally {
    store.close();
  }
}

export async function recordTaskEvidence(options: {
  claimId: string;
  type?: string;
  payload: TaskRecordPayload;
  rootDir?: string;
  claimStorePath?: string;
  consumerConfig?: string;
  historical?: HistoricalEvidenceContext;
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

  const historical = options.historical
    ? await verifyHistoricalEvidenceContext({
        rootDir,
        taskId: claim.taskId,
        consumerConfig,
        context: options.historical,
      })
    : undefined;
  const payload = historical
    ? {
        ...options.payload,
        supportingRefs: [...new Set([...(options.payload.supportingRefs ?? []), historical.pr, historical.commit, historical.publishedRef])],
        notes: [...(options.payload.notes ?? []), ...historical.changedFiles.map((filePath) => `Verified historical changed file: ${filePath}`)],
      }
    : options.payload;

  const recordOptions = buildCreateRecordOptions({
    payload,
    type: options.type,
    consumerConfig,
    subjects: resolveSubjects(options.payload, [
      claim.taskId,
      ...resolveRuntimeRecordSubjects({
        rootDir,
        claimToken: options.claimId,
      }),
    ]),
  });

  const recordPreflight = await createRecord({
    rootDir,
    ...recordOptions,
    dryRun: true,
  });

  const evidenceLink = `[[${path.basename(recordPreflight.filePath, ".md")}]]`;
  const workItemPreflight = await linkWorkItem({
    rootDir,
    consumerConfig,
    id: claim.taskId,
    kind: "evidence",
    value: evidenceLink,
    dryRun: true,
  });

  const runtimeAudit = runRuntimeClaimCoverageAudit({
    rootDir,
    taskId: claim.taskId,
    requiredPaths: [
      path.relative(rootDir, recordPreflight.filePath).split(path.sep).join("/"),
      workItemPreflight.filePath,
    ],
    excludedPaths: historical?.changedFiles,
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
