import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
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

function policyPath(rootDir: string): string {
  const repositoryPolicy = path.join(
    rootDir,
    "schemas/work-management/workflows/default/historical-merge-reconciliation.json",
  );
  return existsSync(repositoryPolicy)
    ? repositoryPolicy
    : fileURLToPath(
        new URL(
          "../../schemas/work-management/workflows/default/historical-merge-reconciliation.json",
          import.meta.url,
        ),
      );
}

async function loadPolicy(rootDir: string): Promise<HistoricalMergePolicy> {
  const document = JSON.parse(await fs.readFile(policyPath(rootDir), "utf8")) as {
    "x-historical-merge-reconciliation"?: HistoricalMergePolicy;
  };
  const policy = document["x-historical-merge-reconciliation"];
  if (
    !policy ||
    !Array.isArray(policy.from) ||
    !policy.from.every((status) => typeof status === "string") ||
    typeof policy.status !== "string" ||
    typeof policy.reason !== "string" ||
    policy.changed_files !== "exact" ||
    !policy.evidence?.ci ||
    !policy.evidence?.review
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
  } catch {
    throw new TaskCommandError(
      "TASK_HISTORICAL_MERGE_COMMIT_NOT_PUBLISHED",
      `Commit '${commit}' is not an ancestor of published ref '${publishedRef}'.`,
      { commit, publishedRef },
    );
  }
}

function normalizePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_MERGE_INVALID_CHANGED_FILE",
      `Changed file '${value}' must be a repository-relative path.`,
      { path: value },
    );
  }
  return normalized;
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
    !record.content.includes(pr) ||
    !record.content.includes(commit)
  ) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_MERGE_UNATTRIBUTED_EVIDENCE",
      `Evidence record '${reference}' is not attributed to this work item, PR, and immutable commit.`,
      { evidence: reference, taskId, pr, commit },
    );
  }
  return { subtype: typeof record.data.subtype === "string" ? record.data.subtype : "", content: record.content };
}

export async function reconcileHistoricalMerge(
  options: ReconcileHistoricalMergeOptions,
): Promise<ReconcileHistoricalMergeResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const policy = await loadPolicy(rootDir);
  const task = await loadTaskModel(options.taskId, { rootDir, backlogDir: options.backlogDir });
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
    !Object.keys(commits as Record<string, unknown>).some((sha) => commit.startsWith(sha.toLowerCase()))
  ) {
    throw new TaskCommandError(
      "TASK_HISTORICAL_MERGE_COMMIT_NOT_LINKED",
      `Commit '${commit}' is not linked to task '${task.id}'.`,
      { taskId: task.id, commit },
    );
  }

  const parent = git(rootDir, ["rev-parse", "--verify", `${commit}^1`]);
  const changedFiles = new Set(
    git(rootDir, ["diff", "--name-only", parent, commit])
      .split("\n")
      .filter(Boolean)
      .map(normalizePath),
  );
  const attributedFiles = new Set(options.changedFiles.map(normalizePath));
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
  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
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
