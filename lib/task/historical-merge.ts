import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { openRuntimeSqliteStore } from "../runtime/index.js";
import { loadConsumerConfig, transitionWorkItem } from "../work-management/index.js";
import { TaskCommandError } from "./errors.js";
import { loadTaskModel } from "./model.js";

interface EvidenceRequirement {
  subtype: string;
  outcome: string;
}

interface HistoricalMergePolicy {
  from: string[];
  status: string;
  reason: string;
  evidence: { ci: EvidenceRequirement; review: EvidenceRequirement };
  changed_files: "exact";
}

export interface ReconcileHistoricalMergeOptions {
  taskId: string;
  pr: string;
  commit: string;
  publishedRef: string;
  evidence: string[];
  changedFiles: string[];
  actual?: number;
  completedDate: string;
  rootDir?: string;
  backlogDir?: string;
  consumerConfig?: string;
  dryRun?: boolean;
}

export interface ReconcileHistoricalMergeResult {
  taskId: string;
  fromStatus: string;
  toStatus: string;
  commit: string;
  publishedRef: string;
  changedFiles: string[];
  workItem: Awaited<ReturnType<typeof transitionWorkItem>>;
}

export interface ReleaseReconciledExpiredClaimOptions {
  taskId: string;
  claimToken: string;
  rootDir?: string;
  backlogDir?: string;
  consumerConfig?: string;
}

function policyPath(rootDir: string): string {
  const repositoryPolicy = path.join(
    rootDir,
    "schemas/work-management/workflows/default/historical-merge-reconciliation.json",
  );
  if (existsSync(repositoryPolicy)) return repositoryPolicy;
  const packagedPolicy = fileURLToPath(
    new URL(
      "../../../schemas/work-management/workflows/default/historical-merge-reconciliation.json",
      import.meta.url,
    ),
  );
  return existsSync(packagedPolicy)
    ? packagedPolicy
    : fileURLToPath(
        new URL(
          "../../schemas/work-management/workflows/default/historical-merge-reconciliation.json",
          import.meta.url,
        ),
      );
}

async function loadPolicy(rootDir: string): Promise<HistoricalMergePolicy> {
  const policyFile = policyPath(rootDir);
  let document: { "x-historical-merge-reconciliation"?: HistoricalMergePolicy } | null;
  try {
    document = JSON.parse(await fs.readFile(policyFile, "utf8")) as typeof document;
  } catch (error) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_MERGE_INVALID_POLICY",
      "Historical merge reconciliation policy cannot be read.",
      { path: policyFile, error: error instanceof Error ? error.message : String(error) },
    );
  }
  const policy = document?.["x-historical-merge-reconciliation"];
  if (
    !policy ||
    !Array.isArray(policy.from) ||
    !policy.from.every((status) => typeof status === "string") ||
    typeof policy.status !== "string" ||
    typeof policy.reason !== "string" ||
    policy.changed_files !== "exact" ||
    typeof policy.evidence?.ci?.subtype !== "string" ||
    typeof policy.evidence?.ci?.outcome !== "string" ||
    typeof policy.evidence?.review?.subtype !== "string" ||
    typeof policy.evidence?.review?.outcome !== "string"
  ) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_MERGE_INVALID_POLICY",
      "Historical merge reconciliation policy is invalid.",
      { path: policyPath(rootDir) },
    );
  }
  return policy;
}

function git(rootDir: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: rootDir, encoding: "utf8" }).trim();
  } catch (error) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_MERGE_GIT_VERIFICATION_FAILED",
      `Unable to verify historical merge with git ${args.join(" ")}.`,
      { args, error: error instanceof Error ? error.message : String(error) },
    );
  }
}

function assertAncestor(rootDir: string, commit: string, publishedRef: string): void {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, publishedRef], {
      cwd: rootDir,
      stdio: "ignore",
    });
  } catch (error) {
    if ((error as { status?: number | null }).status !== 1) {
      throw new TaskCommandError(
        "TASK_HISTORICAL_MERGE_GIT_VERIFICATION_FAILED",
        `Unable to verify ancestry of '${commit}' in '${publishedRef}'.`,
        { commit, publishedRef, error: error instanceof Error ? error.message : String(error) },
      );
    }
    throw new TaskCommandError(
      "TASK_HISTORICAL_MERGE_COMMIT_NOT_PUBLISHED",
      `Commit '${commit}' is not an ancestor of published ref '${publishedRef}'.`,
      { commit, publishedRef },
    );
  }
}

function gitStatus(rootDir: string, args: string[]): string[] {
  try {
    const output = execFileSync("git", args, { cwd: rootDir });
    return output.toString("utf8").split("\0").filter(Boolean);
  } catch (error) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_MERGE_GIT_VERIFICATION_FAILED",
      `Unable to verify historical merge with git ${args.join(" ")}.`,
      { args, error: error instanceof Error ? error.message : String(error) },
    );
  }
}

function validatePath(value: string): string {
  if (!value || value.startsWith("/") || value.split("/").includes("..")) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_MERGE_INVALID_CHANGED_FILE",
      `Changed file '${value}' must be a repository-relative path.`,
      { path: value },
    );
  }
  return value;
}

function evidenceBasename(reference: string): string {
  const value = reference.trim().replace(/^\[\[|\]\]$/g, "").split("|")[0]?.trim() ?? "";
  if (!value) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_MERGE_INVALID_EVIDENCE",
      "Evidence references must be non-empty record references.",
      { reference },
    );
  }
  return value.replace(/^record:/, "record-");
}

function linkedEvidence(values: unknown): Set<string> {
  return new Set(
    Array.isArray(values)
      ? values.filter((value): value is string => typeof value === "string").map(evidenceBasename)
      : [],
  );
}

function hasOutcome(body: string, outcome: string): boolean {
  return new RegExp(`^##\\s+Outcome\\s*\\n\\s*${outcome}\\s*$`, "mi").test(body);
}

function mentionsExactly(body: string, value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`).test(body);
}

function hasTaskAssociation(body: string, taskId: string): boolean {
  const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*-\\s+(?:\\[\\[)?${escaped}(?:\\]\\])?\\s*$`, "m").test(body);
}

async function readEvidence(
  recordsDir: string,
  reference: string,
  taskId: string,
  pr: string,
  commit: string,
): Promise<{ subtype: string; content: string }> {
  const basename = evidenceBasename(reference);
  let record: ReturnType<typeof matter>;
  try {
    record = matter(await fs.readFile(path.join(recordsDir, `${basename}.md`), "utf8"));
  } catch {
    throw new TaskCommandError(
      "TASK_HISTORICAL_MERGE_INVALID_EVIDENCE",
      `Evidence record '${reference}' does not exist.`,
      { evidence: reference },
    );
  }
  if (
    record.data?.type !== "record" ||
    !hasTaskAssociation(record.content, taskId) ||
    !mentionsExactly(record.content, pr) ||
    !mentionsExactly(record.content, commit)
  ) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_MERGE_UNATTRIBUTED_EVIDENCE",
      `Evidence record '${reference}' is not attributed to this work item, PR, and immutable commit.`,
      { evidence: reference, taskId, pr, commit },
    );
  }
  return { subtype: typeof record.data.subtype === "string" ? record.data.subtype : "", content: record.content };
}

export async function releaseReconciledExpiredClaim(
  options: ReleaseReconciledExpiredClaimOptions,
) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const backlogDir = options.backlogDir ?? config.roots.backlog;
  if (path.resolve(rootDir, backlogDir) !== path.resolve(rootDir, config.roots.backlog)) {
    throw new TaskCommandError(
      "TASK_RELEASE_RECONCILED_BACKLOG_ROOT_MISMATCH",
      "Reconciled claim release requires --backlog-dir to match the consumer configuration.",
      { backlogDir, configuredBacklogDir: config.roots.backlog },
    );
  }
  const task = await loadTaskModel(options.taskId, { rootDir, backlogDir });
  if (task.status !== "completed") {
    throw new TaskCommandError(
      "TASK_RELEASE_RECONCILED_INCOMPLETE_TASK",
      `Task '${task.id}' must be completed before its reconciled claim can be released.`,
      { taskId: task.id, status: task.status },
    );
  }

  const runtimeDatabase = path.join(rootDir, ".doc-vader", "runtime", "runtime.sqlite");
  if (!existsSync(runtimeDatabase)) {
    throw new TaskCommandError(
      "TASK_RELEASE_RECONCILED_MISSING_CLAIM",
      `Claim '${options.claimToken}' does not exist.`,
      { claimToken: options.claimToken },
    );
  }
  const store = openRuntimeSqliteStore({ rootDir });
  try {
    const result = store.releaseReconciledExpiredRuntimeClaim(
      task.id,
      options.claimToken,
    );
    if (result.outcome === "released") {
      return { taskId: task.id, ...result };
    }
    const errors = {
      missing: [
        "TASK_RELEASE_RECONCILED_MISSING_CLAIM",
        `Claim '${options.claimToken}' does not exist.`,
      ],
      active: [
        "TASK_RELEASE_RECONCILED_ACTIVE_CLAIM",
        `Claim '${options.claimToken}' is still active.`,
      ],
      foreign: [
        "TASK_RELEASE_RECONCILED_FOREIGN_CLAIM",
        `Claim '${options.claimToken}' does not belong to task '${task.id}'.`,
      ],
      "manifest-mismatch": [
        "TASK_RELEASE_RECONCILED_MANIFEST_MISMATCH",
        `Claim '${options.claimToken}' has no matching verified reconciliation manifest.`,
      ],
    } as const;
    const [code, message] = errors[result.reason];
    throw new TaskCommandError(code, message, {
      taskId: task.id,
      claimToken: options.claimToken,
      reason: result.reason,
    });
  } finally {
    store.close();
  }
}

export async function reconcileHistoricalMerge(
  options: ReconcileHistoricalMergeOptions,
): Promise<ReconcileHistoricalMergeResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const backlogDir = options.backlogDir ?? config.roots.backlog;
  if (path.resolve(rootDir, backlogDir) !== path.resolve(rootDir, config.roots.backlog)) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_MERGE_BACKLOG_ROOT_MISMATCH",
      "Historical merge reconciliation requires --backlog-dir to match the consumer configuration.",
      { backlogDir, configuredBacklogDir: config.roots.backlog },
    );
  }
  const policy = await loadPolicy(rootDir);
  const task = await loadTaskModel(options.taskId, { rootDir, backlogDir });
  if (!policy.from.includes(task.status)) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_MERGE_STATUS_MISMATCH",
      `Task '${task.id}' must be ${policy.from.join(" or ")} for historical merge reconciliation.`,
      { taskId: task.id, status: task.status, expected: policy.from },
    );
  }
  if (task.estimated !== undefined && options.actual === undefined) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_MERGE_ACTUAL_REQUIRED",
      `Task '${task.id}' has an estimate and requires --actual.`,
      { taskId: task.id },
    );
  }

  const rawTask = matter(await fs.readFile(path.resolve(rootDir, task.filePath), "utf8"));
  const pullRequests = rawTask.data?.links?.pull_requests;
  if (!Array.isArray(pullRequests) || !pullRequests.includes(options.pr)) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_MERGE_PR_NOT_LINKED",
      `PR '${options.pr}' is not linked to task '${task.id}'.`,
      { taskId: task.id, pr: options.pr },
    );
  }

  const commit = git(rootDir, ["rev-parse", "--verify", `${options.commit}^{commit}`]);
  git(rootDir, ["rev-parse", "--verify", `${options.publishedRef}^{commit}`]);
  assertAncestor(rootDir, commit, options.publishedRef);
  const commits = rawTask.data?.commits;
  if (
    typeof commits !== "object" ||
    commits === null ||
    Array.isArray(commits) ||
    !Object.keys(commits as Record<string, unknown>).some(
      (sha) => /^[0-9a-f]{7,40}$/i.test(sha) && commit.startsWith(sha.toLowerCase()),
    )
  ) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_MERGE_COMMIT_NOT_LINKED",
      `Commit '${commit}' is not linked to task '${task.id}'.`,
      { taskId: task.id, commit },
    );
  }

  const parent = git(rootDir, ["rev-parse", "--verify", `${commit}^1`]);
  const diff = gitStatus(rootDir, ["diff", "--name-status", "--find-renames", "-z", parent, commit]);
  const changedFiles = new Set<string>();
  for (let index = 0; index < diff.length;) {
    const status = diff[index++]!;
    if (status.startsWith("R") || status.startsWith("C")) {
      throw new TaskCommandError(
        "TASK_HISTORICAL_MERGE_RENAME_NOT_SUPPORTED",
        "Historical merge reconciliation rejects renamed or copied files.",
        { status },
      );
    }
    const filePath = diff[index++];
    if (!filePath) {
      throw new TaskCommandError(
        "TASK_HISTORICAL_MERGE_GIT_VERIFICATION_FAILED",
        "Historical merge changed-file output is malformed.",
        { status },
      );
    }
    changedFiles.add(validatePath(filePath));
  }
  const attributedFiles = new Set(options.changedFiles.map(validatePath));
  if (
    policy.changed_files !== "exact" ||
    changedFiles.size !== attributedFiles.size ||
    [...changedFiles].some((filePath) => !attributedFiles.has(filePath))
  ) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_MERGE_UNATTRIBUTED_CHANGED_FILE",
      "Every historical commit file must be explicitly attributed; foreign or missing paths are rejected.",
      { changedFiles: [...changedFiles], attributedFiles: [...attributedFiles] },
    );
  }

  const linked = linkedEvidence(rawTask.data?.links?.evidence);
  const supplied = [...new Set(options.evidence.map(evidenceBasename))];
  if (supplied.length === 0 || supplied.some((reference) => !linked.has(reference))) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_MERGE_EVIDENCE_NOT_LINKED",
      "All reconciliation evidence must already be linked to the work item.",
      { suppliedEvidence: supplied, linkedEvidence: [...linked] },
    );
  }
  const recordsDir = path.resolve(rootDir, config.roots.records);
  const records = await Promise.all(
    options.evidence.map((reference) => readEvidence(recordsDir, reference, task.id, options.pr, commit)),
  );
  for (const [kind, requirement] of Object.entries(policy.evidence)) {
    if (!records.some((record) => record.subtype === requirement.subtype && hasOutcome(record.content, requirement.outcome))) {
      throw new TaskCommandError(
        "TASK_HISTORICAL_MERGE_MISSING_EVIDENCE",
        `Historical merge reconciliation requires ${kind} evidence (${requirement.subtype}/${requirement.outcome}).`,
        { kind, requirement },
      );
    }
  }

  const workItem = await transitionWorkItem({
    rootDir,
    consumerConfig: options.consumerConfig,
    id: task.id,
    status: policy.status,
    statusReason: policy.reason,
    actual: options.actual,
    completedDate: options.completedDate,
    dryRun: options.dryRun,
  });
  const runtimeDatabase = path.join(
    rootDir,
    ".doc-vader",
    "runtime",
    "runtime.sqlite",
  );
  if (!options.dryRun && existsSync(runtimeDatabase)) {
    const store = openRuntimeSqliteStore({ rootDir });
    try {
      store.recordVerifiedHistoricalMerge({
        taskId: task.id,
        commit,
        changedPaths: [...changedFiles],
      });
    } finally {
      store.close();
    }
  }
  return {
    taskId: task.id,
    fromStatus: task.status,
    toStatus: policy.status,
    commit,
    publishedRef: options.publishedRef,
    changedFiles: [...changedFiles].sort(),
    workItem,
  };
}
