import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { loadConsumerConfig, transitionWorkItem } from "../work-management/index.js";
import { TaskCommandError } from "./errors.js";
import { loadTaskModel } from "./model.js";

interface DirectPushPolicy {
  enabled: true;
  repository: string;
  protected_ref: string;
  from: string[];
  status: string;
  reason: string;
  receipt: { subtype: string; outcome: string };
  changed_files: "exact";
}

export interface ReconcileDirectPushOptions {
  taskId: string;
  commit: string;
  receipt: string;
  receiptCommit: string;
  changedFiles: string[];
  actual?: number;
  completedDate: string;
  rootDir?: string;
  backlogDir?: string;
  consumerConfig?: string;
  dryRun?: boolean;
}

export interface ReconcileDirectPushResult {
  taskId: string;
  fromStatus: string;
  toStatus: string;
  commit: string;
  receiptCommit: string;
  changedFiles: string[];
  workItem: Awaited<ReturnType<typeof transitionWorkItem>>;
}

function fail(code: string, message: string, detail: Record<string, unknown> = {}): never {
  throw new TaskCommandError(code, message, detail);
}

async function loadPolicy(rootDir: string): Promise<DirectPushPolicy> {
  const policyPath = path.join(rootDir, ".doc-vader", "direct-push-reconciliation.json");
  if (!existsSync(policyPath)) {
    fail("TASK_DIRECT_PUSH_POLICY_DISABLED", "Direct-push reconciliation is disabled without a project-local policy.", { path: policyPath });
  }
  let policy: unknown;
  try {
    policy = JSON.parse(await fs.readFile(policyPath, "utf8"));
  } catch (error) {
    fail("TASK_DIRECT_PUSH_POLICY_INVALID", "Direct-push reconciliation policy cannot be read.", { path: policyPath, error: error instanceof Error ? error.message : String(error) });
  }
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    fail("TASK_DIRECT_PUSH_POLICY_INVALID", "Direct-push reconciliation policy is invalid.", { path: policyPath });
  }
  const raw = policy as Record<string, unknown>;
  const value = raw as Omit<Partial<DirectPushPolicy>, "enabled"> & { enabled?: boolean; $schema?: unknown };
  const receipt = raw.receipt as Record<string, unknown> | undefined;
  const allowed = new Set(["$schema", "enabled", "repository", "protected_ref", "from", "status", "reason", "receipt", "changed_files"]);
  if (value.enabled === false) {
    fail("TASK_DIRECT_PUSH_POLICY_DISABLED", "Direct-push reconciliation is disabled by the project-local policy.", { path: policyPath });
  }
  if (
    Object.keys(raw).some((key) => !allowed.has(key)) ||
    (value.$schema !== undefined && typeof value.$schema !== "string") ||
    value.enabled !== true ||
    typeof value.repository !== "string" || !/^github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository) ||
    typeof value.protected_ref !== "string" || !/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(value.protected_ref) ||
    !Array.isArray(value.from) || value.from.length === 0 || !value.from.every((status) => typeof status === "string" && status.length > 0) ||
    typeof value.status !== "string" || value.status.length === 0 ||
    typeof value.reason !== "string" || value.reason.length === 0 ||
    value.changed_files !== "exact" ||
    !receipt || Object.keys(receipt).some((key) => key !== "subtype" && key !== "outcome") ||
    typeof receipt.subtype !== "string" || receipt.subtype.length === 0 ||
    typeof receipt.outcome !== "string" || receipt.outcome.length === 0
  ) {
    fail("TASK_DIRECT_PUSH_POLICY_INVALID", "Direct-push reconciliation policy is invalid.", { path: policyPath });
  }
  return value as DirectPushPolicy;
}

function git(rootDir: string, args: string[], code: string): string {
  try {
    return execFileSync("git", args, { cwd: rootDir, encoding: "utf8" }).trim();
  } catch (error) {
    fail(code, `Unable to verify direct push with git ${args.join(" ")}.`, { args, error: error instanceof Error ? error.message : String(error) });
  }
}

function assertAncestor(rootDir: string, commit: string, ref: string, code: string): void {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, ref], { cwd: rootDir, stdio: "ignore" });
  } catch {
    fail(code, `Commit '${commit}' is not reachable from '${ref}'.`, { commit, ref });
  }
}

function assertImmutableCommit(rootDir: string, value: string, label: string): string {
  if (!/^[0-9a-f]{40}$/i.test(value)) {
    fail("TASK_DIRECT_PUSH_COMMIT_INVALID", `${label} must be a full immutable commit SHA.`, { value });
  }
  const commit = git(rootDir, ["rev-parse", "--verify", `${value}^{commit}`], "TASK_DIRECT_PUSH_COMMIT_INVALID").toLowerCase();
  if (commit !== value.toLowerCase()) {
    fail("TASK_DIRECT_PUSH_COMMIT_INVALID", `${label} must resolve exactly to its full commit SHA.`, { value, commit });
  }
  return commit;
}

function originRepository(rootDir: string): string {
  const origin = git(rootDir, ["config", "--get", "remote.origin.url"], "TASK_DIRECT_PUSH_ORIGIN_MISMATCH");
  const match = origin.match(/^(?:https:\/\/|ssh:\/\/git@|git@)?github\.com(?::|\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  if (!match) fail("TASK_DIRECT_PUSH_ORIGIN_MISMATCH", "Origin must be a GitHub repository URL.", { origin });
  return `github.com/${match[1]}/${match[2]}`;
}

function gh(args: string[], code: string): string {
  try {
    const command = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "gh";
    const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", "gh", ...args] : args;
    return execFileSync(command, commandArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    fail(code, `GitHub CLI verification failed: gh ${args.join(" ")}.`, { args });
  }
}

function verifyAdmin(repository: string): void {
  gh(["auth", "status", "--hostname", "github.com"], "TASK_DIRECT_PUSH_GH_AUTH_FAILED");
  const viewer = gh(["api", "--hostname", "github.com", "user", "--jq", ".login"], "TASK_DIRECT_PUSH_GH_AUTH_FAILED");
  if (!/^[A-Za-z0-9-]+$/.test(viewer)) {
    fail("TASK_DIRECT_PUSH_GH_AUTH_FAILED", "GitHub CLI did not return a valid authenticated viewer.");
  }
  const permission = gh(["api", "--hostname", "github.com", `repos/${repository.slice("github.com/".length)}/collaborators/${viewer}/permission`, "--jq", ".permission"], "TASK_DIRECT_PUSH_ADMIN_REQUIRED");
  if (permission !== "admin") {
    fail("TASK_DIRECT_PUSH_ADMIN_REQUIRED", "The authenticated GitHub viewer must have admin permission for the configured origin repository.", { repository, viewer, permission });
  }
}

function validatePath(value: string): string {
  if (!value || value.startsWith("/") || value.split("/").includes("..")) {
    fail("TASK_DIRECT_PUSH_MANIFEST_MISMATCH", `Changed file '${value}' must be a repository-relative path.`, { path: value });
  }
  return value;
}

function receiptBasename(reference: string): string {
  const value = reference.trim().replace(/^\[\[|\]\]$/g, "").split("|")[0]?.trim() ?? "";
  const basename = value.replace(/^record:/, "record-");
  if (!basename || basename.includes("/") || basename.includes("..")) {
    fail("TASK_DIRECT_PUSH_RECEIPT_INVALID", "Receipt must be a record reference.", { receipt: reference });
  }
  return basename;
}

function mentionsExactly(body: string, value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`).test(body);
}

function hasTaskAssociation(body: string, taskId: string): boolean {
  const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*-\\s+(?:\\[\\[)?${escaped}(?:\\]\\])?\\s*$`, "m").test(body);
}

function linkedEvidence(values: unknown): Set<string> {
  return new Set(Array.isArray(values) ? values.filter((value): value is string => typeof value === "string").map(receiptBasename) : []);
}

export async function reconcileDirectPush(options: ReconcileDirectPushOptions): Promise<ReconcileDirectPushResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const policy = await loadPolicy(rootDir);
  if (originRepository(rootDir) !== policy.repository) {
    fail("TASK_DIRECT_PUSH_ORIGIN_MISMATCH", "Configured direct-push repository does not match origin.", { configuredRepository: policy.repository });
  }
  verifyAdmin(policy.repository);
  const commit = assertImmutableCommit(rootDir, options.commit, "Commit");
  const receiptCommit = assertImmutableCommit(rootDir, options.receiptCommit, "Receipt commit");
  git(rootDir, ["fetch", "--no-tags", "origin", policy.protected_ref], "TASK_DIRECT_PUSH_PROTECTED_REF_VERIFICATION_FAILED");
  const protectedCommit = git(rootDir, ["rev-parse", "--verify", "FETCH_HEAD^{commit}"], "TASK_DIRECT_PUSH_PROTECTED_REF_VERIFICATION_FAILED");
  assertAncestor(rootDir, commit, protectedCommit, "TASK_DIRECT_PUSH_PROTECTED_REF_VERIFICATION_FAILED");
  assertAncestor(rootDir, receiptCommit, protectedCommit, "TASK_DIRECT_PUSH_RECEIPT_INVALID");
  assertAncestor(rootDir, commit, receiptCommit, "TASK_DIRECT_PUSH_RECEIPT_INVALID");

  const config = await loadConsumerConfig(rootDir, options.consumerConfig);
  const backlogDir = options.backlogDir ?? config.roots.backlog;
  if (path.resolve(rootDir, backlogDir) !== path.resolve(rootDir, config.roots.backlog)) {
    fail("TASK_DIRECT_PUSH_BACKLOG_ROOT_MISMATCH", "Direct-push reconciliation requires --backlog-dir to match the consumer configuration.");
  }
  const task = await loadTaskModel(options.taskId, { rootDir, backlogDir });
  if (!policy.from.includes(task.status)) {
    fail("TASK_DIRECT_PUSH_STATUS_MISMATCH", `Task '${task.id}' must be ${policy.from.join(" or ")} for direct-push reconciliation.`, { taskId: task.id, status: task.status, expected: policy.from });
  }
  if (task.estimated !== undefined && options.actual === undefined) {
    fail("TASK_DIRECT_PUSH_ACTUAL_REQUIRED", `Task '${task.id}' has an estimate and requires --actual.`, { taskId: task.id });
  }

  const receiptTask = matter(git(rootDir, ["show", `${receiptCommit}:${task.filePath.replaceAll(path.sep, "/")}`], "TASK_DIRECT_PUSH_RECEIPT_INVALID"));
  const commits = receiptTask.data?.commits;
  if (typeof commits !== "object" || commits === null || Array.isArray(commits) || !Object.keys(commits as Record<string, unknown>).includes(commit)) {
    fail("TASK_DIRECT_PUSH_RECEIPT_INVALID", "Receipt commit does not immutably link the direct-push commit to the work item.", { taskId: task.id, commit, receiptCommit });
  }
  const receipt = receiptBasename(options.receipt);
  if (!linkedEvidence(receiptTask.data?.links?.evidence).has(receipt)) {
    fail("TASK_DIRECT_PUSH_RECEIPT_INVALID", "Receipt is not immutably linked to the work item.", { receipt, receiptCommit });
  }
  const receiptDocument = matter(git(rootDir, ["show", `${receiptCommit}:${path.posix.join(config.roots.records.replaceAll(path.sep, "/"), `${receipt}.md`)}`], "TASK_DIRECT_PUSH_RECEIPT_INVALID"));
  if (
    receiptDocument.data?.type !== "record" ||
    receiptDocument.data?.subtype !== policy.receipt.subtype ||
    !hasTaskAssociation(receiptDocument.content, task.id) ||
    !mentionsExactly(receiptDocument.content, commit) ||
    !new RegExp(`^##\\s+Outcome\\s*\\n\\s*${policy.receipt.outcome}\\s*$`, "mi").test(receiptDocument.content)
  ) {
    fail("TASK_DIRECT_PUSH_RECEIPT_INVALID", "Receipt is not an immutable approved evidence record for this work item and commit.", { receipt, receiptCommit });
  }

  const parent = git(rootDir, ["rev-parse", "--verify", `${commit}^1`], "TASK_DIRECT_PUSH_COMMIT_INVALID");
  const diff = git(rootDir, ["diff", "--name-status", "--find-renames", "-z", parent, commit], "TASK_DIRECT_PUSH_MANIFEST_MISMATCH").split("\0").filter(Boolean);
  const changedFiles = new Set<string>();
  for (let index = 0; index < diff.length;) {
    const status = diff[index++]!;
    if (status.startsWith("R") || status.startsWith("C")) fail("TASK_DIRECT_PUSH_MANIFEST_MISMATCH", "Direct-push reconciliation rejects renamed or copied files.", { status });
    const filePath = diff[index++];
    if (!filePath) fail("TASK_DIRECT_PUSH_MANIFEST_MISMATCH", "Direct-push changed-file output is malformed.", { status });
    changedFiles.add(validatePath(filePath));
  }
  const manifest = new Set(options.changedFiles.map(validatePath));
  if (policy.changed_files !== "exact" || options.changedFiles.length !== manifest.size || changedFiles.size !== manifest.size || [...changedFiles].some((filePath) => !manifest.has(filePath))) {
    fail("TASK_DIRECT_PUSH_MANIFEST_MISMATCH", "Direct-push reconciliation requires an exact changed-file manifest.", { changedFiles: [...changedFiles], manifest: [...manifest] });
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
  return { taskId: task.id, fromStatus: task.status, toStatus: policy.status, commit, receiptCommit, changedFiles: [...changedFiles].sort(), workItem };
}
