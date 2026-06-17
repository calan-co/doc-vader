import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as fsSync from "node:fs";
import path from "node:path";
import { TaskCommandError } from "./errors.js";

export type ClaimState =
  | "active"
  | "expired"
  | "released"
  | "abandoned"
  | "missing";

export interface TaskClaimGitContext {
  branch?: string;
  baseRef?: string;
  headRef?: string;
  headSha?: string;
  worktreePath?: string;
}

export interface TaskClaimRecoveryContext {
  adoptedAt?: string;
  abandonedAt?: string;
  abandonedReason?: string;
}

export interface TaskClaim {
  id: string;
  taskId: string;
  holder: string;
  schemaVersion?: "task-claim/v2";
  branch?: string;
  sandbox?: string;
  git?: TaskClaimGitContext;
  recovery?: TaskClaimRecoveryContext;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  lastHeartbeatAt?: string;
  releasedAt?: string;
}

interface ClaimStoreFile {
  claims: TaskClaim[];
}

export interface ClaimStatus {
  claimId: string;
  taskId?: string;
  state: ClaimState;
  claim?: TaskClaim;
}

export interface ClaimTaskOptions {
  rootDir?: string;
  claimStorePath?: string;
  holder?: string;
  branch?: string;
  sandbox?: string;
  baseRef?: string;
  headRef?: string;
  headSha?: string;
  worktreePath?: string;
  ttlMinutes?: number;
  now?: Date;
}

export type ClaimRecoveryClassification =
  | "release_safe"
  | "adopt_recommended"
  | "manual_review_required"
  | "terminal";

export interface ClaimRecoveryReport {
  claimId: string;
  taskId?: string;
  state: ClaimState;
  classification: ClaimRecoveryClassification;
  reasons: string[];
  claim?: TaskClaim;
  git?: {
    branch?: string;
    baseRef?: string;
    headRef?: string;
    worktreePath?: string;
    branchExists: boolean;
    uniqueCommitCount?: number;
    headSha?: string;
  };
}

export interface RecoverClaimOptions {
  rootDir?: string;
  claimStorePath?: string;
  now?: Date;
  action?: "inspect" | "release" | "adopt" | "abandon";
  holder?: string;
  ttlMinutes?: number;
  reason?: string;
  force?: boolean;
}

const DEFAULT_TTL_MINUTES = 240;
const CLAIM_STORE_PATH = ".doc-vader/task-claims.json";
const CLAIM_STORE_ENV = "DOC_VADER_TASK_CLAIM_STORE";
const CONSUMER_CONFIG_PATH = ".doc-vader/backlog-consumer.json";
const CLAIM_LOCK_TIMEOUT_MS = 10_000;
const CLAIM_LOCK_STALE_MS = 300_000;
const CLAIM_LOCK_RETRY_MS = 25;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function configuredClaimStorePath(rootDir: string): string | undefined {
  const configPath = path.resolve(rootDir, CONSUMER_CONFIG_PATH);
  if (!fsSync.existsSync(configPath)) {
    return undefined;
  }
  const config = JSON.parse(
    fsSync.readFileSync(configPath, "utf8"),
  ) as Record<string, unknown>;
  const taskConfig = asRecord(config.task);
  const automationConfig = asRecord(config.automation);
  const configured =
    typeof taskConfig?.claimStorePath === "string"
      ? taskConfig.claimStorePath
      : typeof automationConfig?.claimStorePath === "string"
        ? automationConfig.claimStorePath
        : undefined;
  return configured?.trim();
}

function claimStorePath(rootDir: string, overridePath?: string): string {
  if (overridePath?.trim()) {
    return path.isAbsolute(overridePath)
      ? overridePath
      : path.resolve(rootDir, overridePath);
  }
  const configuredPath = process.env[CLAIM_STORE_ENV]?.trim();
  if (configuredPath) {
    return path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(rootDir, configuredPath);
  }
  const configPath = configuredClaimStorePath(rootDir);
  if (configPath) {
    return path.isAbsolute(configPath)
      ? configPath
      : path.resolve(rootDir, configPath);
  }
  return path.resolve(rootDir, CLAIM_STORE_PATH);
}

async function readStore(
  rootDir: string,
  claimStorePathOverride?: string,
): Promise<ClaimStoreFile> {
  try {
    return JSON.parse(
      await fs.readFile(claimStorePath(rootDir, claimStorePathOverride), "utf8"),
    ) as ClaimStoreFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { claims: [] };
    }
    throw error;
  }
}

async function writeStoreUnlocked(
  rootDir: string,
  store: ClaimStoreFile,
  claimStorePathOverride?: string,
): Promise<void> {
  const filePath = claimStorePath(rootDir, claimStorePathOverride);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireStoreLock(
  rootDir: string,
  claimStorePathOverride?: string,
): Promise<() => Promise<void>> {
  const filePath = claimStorePath(rootDir, claimStorePathOverride);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  const startedAt = Date.now();

  while (true) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }),
        "utf8",
      );
      return async () => {
        await handle.close();
        await fs.unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") {
            throw error;
          }
        });
      };
    } catch (error) {
      const lockError = error as NodeJS.ErrnoException;
      if (lockError.code !== "EEXIST") {
        throw error;
      }

      const stat = await fs.stat(lockPath).catch(() => undefined);
      if (stat && Date.now() - stat.mtimeMs > CLAIM_LOCK_STALE_MS) {
        await fs.unlink(lockPath).catch(() => undefined);
        continue;
      }
      if (Date.now() - startedAt >= CLAIM_LOCK_TIMEOUT_MS) {
        throw new TaskCommandError(
          "TASK_CLAIM_STORE_LOCKED",
          "Timed out waiting for the local task claim store lock.",
          { lockPath },
        );
      }
      await wait(CLAIM_LOCK_RETRY_MS);
    }
  }
}

async function updateStore<T>(
  rootDir: string,
  claimStorePathOverride: string | undefined,
  update: (store: ClaimStoreFile) => T | Promise<T>,
): Promise<T> {
  const releaseLock = await acquireStoreLock(rootDir, claimStorePathOverride);
  try {
    const store = await readStore(rootDir, claimStorePathOverride);
    const result = await update(store);
    await writeStoreUnlocked(rootDir, store, claimStorePathOverride);
    return result;
  } finally {
    await releaseLock();
  }
}

function isReleased(claim: TaskClaim): boolean {
  return typeof claim.releasedAt === "string" && claim.releasedAt.length > 0;
}

function isAbandoned(claim: TaskClaim): boolean {
  return (
    typeof claim.recovery?.abandonedAt === "string" &&
    claim.recovery.abandonedAt.length > 0
  );
}

function isExpired(claim: TaskClaim, now: Date): boolean {
  return Date.parse(claim.expiresAt) <= now.getTime();
}

function getState(claim: TaskClaim, now: Date): Exclude<ClaimState, "missing"> {
  if (isReleased(claim)) {
    return "released";
  }
  if (isAbandoned(claim)) {
    return "abandoned";
  }
  if (isExpired(claim, now)) {
    return "expired";
  }
  return "active";
}

function normalizeHolder(holder: string | undefined): string {
  const value = holder?.trim();
  if (value) {
    return value;
  }
  return process.env.USER ?? process.env.USERNAME ?? "local-agent";
}

function claimGitContext(options: ClaimTaskOptions): TaskClaimGitContext | undefined {
  const git: TaskClaimGitContext = {
    ...(options.branch ? { branch: options.branch } : {}),
    ...(options.baseRef ? { baseRef: options.baseRef } : {}),
    ...(options.headRef ? { headRef: options.headRef } : {}),
    ...(options.headSha ? { headSha: options.headSha } : {}),
    ...(options.worktreePath ?? options.sandbox
      ? { worktreePath: options.worktreePath ?? options.sandbox }
      : {}),
  };
  return Object.keys(git).length > 0 ? git : undefined;
}

function gitOutput(
  rootDir: string,
  args: string[],
): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function branchExists(rootDir: string, branch: string): boolean {
  return gitOutput(rootDir, ["rev-parse", "--verify", "--quiet", branch]) !== undefined;
}

function uniqueCommitCount(
  rootDir: string,
  baseRef: string,
  branch: string,
): number | undefined {
  const count = gitOutput(rootDir, [
    "rev-list",
    "--count",
    `${baseRef}..${branch}`,
  ]);
  if (count === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(count, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeClaim(claim: TaskClaim): TaskClaim {
  const git = claim.git ?? claimGitContext({
    branch: claim.branch,
    sandbox: claim.sandbox,
  });
  return {
    ...claim,
    schemaVersion: claim.schemaVersion ?? "task-claim/v2",
    ...(git ? { git } : {}),
  };
}

export async function claimTask(
  taskId: string,
  options: ClaimTaskOptions = {},
): Promise<ClaimStatus> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const now = options.now ?? new Date();
  return updateStore(rootDir, options.claimStorePath, (store) => {
    const conflictingClaim = store.claims.find(
      (claim) => claim.taskId === taskId && getState(claim, now) === "active",
    );
    if (conflictingClaim) {
      throw new TaskCommandError(
        "TASK_CLAIM_CONFLICT",
        `Task '${taskId}' already has an active local claim.`,
        {
          taskId,
          claim: {
            id: conflictingClaim.id,
            holder: conflictingClaim.holder,
            branch: conflictingClaim.branch,
            sandbox: conflictingClaim.sandbox,
            expiresAt: conflictingClaim.expiresAt,
          },
        },
      );
    }

    const expiredClaim = store.claims.find(
      (claim) => claim.taskId === taskId && getState(claim, now) === "expired",
    );
    if (expiredClaim) {
      throw new TaskCommandError(
        "TASK_CLAIM_EXPIRED",
        `Task '${taskId}' has an expired local claim that must be released explicitly.`,
        {
          taskId,
          claimId: expiredClaim.id,
          expiresAt: expiredClaim.expiresAt,
        },
      );
    }

    const ttlMinutes = options.ttlMinutes ?? DEFAULT_TTL_MINUTES;
    const claim: TaskClaim = {
      id: `claim-${randomUUID()}`,
      taskId,
      holder: normalizeHolder(options.holder),
      schemaVersion: "task-claim/v2",
      ...(options.branch ? { branch: options.branch } : {}),
      ...(options.sandbox ? { sandbox: options.sandbox } : {}),
      ...(claimGitContext(options) ? { git: claimGitContext(options) } : {}),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
    };
    store.claims.push(claim);
    return {
      claimId: claim.id,
      taskId,
      state: getState(claim, now),
      claim,
    };
  });
}

export async function getClaimStatus(
  claimId: string,
  options: { rootDir?: string; claimStorePath?: string; now?: Date } = {},
): Promise<ClaimStatus> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const now = options.now ?? new Date();
  const store = await readStore(rootDir, options.claimStorePath);
  const claim = store.claims.find((entry) => entry.id === claimId);
  if (!claim) {
    return { claimId, state: "missing" };
  }
  return {
    claimId,
    taskId: claim.taskId,
    state: getState(claim, now),
    claim,
  };
}

export async function releaseClaim(
  claimId: string,
  options: { rootDir?: string; claimStorePath?: string; now?: Date } = {},
): Promise<ClaimStatus> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const now = options.now ?? new Date();
  return updateStore(rootDir, options.claimStorePath, (store) => {
    const claim = store.claims.find((entry) => entry.id === claimId);
    if (!claim) {
      return { claimId, state: "missing" };
    }
    if (!isReleased(claim)) {
      claim.releasedAt = now.toISOString();
      claim.updatedAt = now.toISOString();
    }
    return {
      claimId,
      taskId: claim.taskId,
      state: getState(claim, now),
      claim,
    };
  });
}

export async function listTaskClaims(
  options: { rootDir?: string; claimStorePath?: string; now?: Date } = {},
): Promise<ClaimStatus[]> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const now = options.now ?? new Date();
  const store = await readStore(rootDir, options.claimStorePath);
  return store.claims.map((entry) => {
    const claim = normalizeClaim(entry);
    return {
      claimId: claim.id,
      taskId: claim.taskId,
      state: getState(claim, now),
      claim,
    };
  });
}

export async function recoverClaim(
  claimId: string,
  options: RecoverClaimOptions = {},
): Promise<ClaimRecoveryReport> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const now = options.now ?? new Date();
  const action = options.action ?? "inspect";

  const classify = (claim: TaskClaim | undefined): ClaimRecoveryReport => {
    if (!claim) {
      return {
        claimId,
        state: "missing",
        classification: "manual_review_required",
        reasons: ["claim_missing"],
      };
    }
    const normalized = normalizeClaim(claim);
    const state = getState(normalized, now);
    const branch = normalized.git?.branch ?? normalized.branch;
    const baseRef = normalized.git?.baseRef ?? "HEAD";
    const exists = branch ? branchExists(rootDir, branch) : false;
    const commitCount =
      branch && exists ? uniqueCommitCount(rootDir, baseRef, branch) : undefined;
    const headSha =
      branch && exists
        ? gitOutput(rootDir, ["rev-parse", `${branch}^{commit}`])
        : normalized.git?.headSha;
    const reasons: string[] = [];

    if (state === "released" || state === "abandoned") {
      reasons.push(`claim_${state}`);
      return {
        claimId,
        taskId: normalized.taskId,
        state,
        classification: "terminal",
        reasons,
        claim: normalized,
        git: {
          ...(branch ? { branch } : {}),
          baseRef,
          ...(normalized.git?.headRef ? { headRef: normalized.git.headRef } : {}),
          ...(normalized.git?.worktreePath
            ? { worktreePath: normalized.git.worktreePath }
            : {}),
          branchExists: exists,
          ...(commitCount !== undefined ? { uniqueCommitCount: commitCount } : {}),
          ...(headSha ? { headSha } : {}),
        },
      };
    }

    if (state === "active") {
      reasons.push("claim_active");
      return {
        claimId,
        taskId: normalized.taskId,
        state,
        classification: "manual_review_required",
        reasons,
        claim: normalized,
        git: {
          ...(branch ? { branch } : {}),
          baseRef,
          branchExists: exists,
          ...(commitCount !== undefined ? { uniqueCommitCount: commitCount } : {}),
          ...(headSha ? { headSha } : {}),
        },
      };
    }

    if (!branch) {
      reasons.push("expired_claim_without_branch_context");
      return {
        claimId,
        taskId: normalized.taskId,
        state,
        classification: "manual_review_required",
        reasons,
        claim: normalized,
        git: { baseRef, branchExists: false },
      };
    }

    if (!exists) {
      reasons.push("expired_claim_branch_missing");
      return {
        claimId,
        taskId: normalized.taskId,
        state,
        classification: "manual_review_required",
        reasons,
        claim: normalized,
        git: { branch, baseRef, branchExists: false },
      };
    }

    if (commitCount === undefined) {
      reasons.push("expired_claim_unique_commits_unknown");
      return {
        claimId,
        taskId: normalized.taskId,
        state,
        classification: "manual_review_required",
        reasons,
        claim: normalized,
        git: { branch, baseRef, branchExists: true, ...(headSha ? { headSha } : {}) },
      };
    }

    if (commitCount > 0) {
      reasons.push("expired_claim_branch_has_unique_commits");
      return {
        claimId,
        taskId: normalized.taskId,
        state,
        classification: "adopt_recommended",
        reasons,
        claim: normalized,
        git: {
          branch,
          baseRef,
          branchExists: true,
          uniqueCommitCount: commitCount,
          ...(headSha ? { headSha } : {}),
        },
      };
    }

    reasons.push("expired_claim_branch_has_no_unique_commits");
    return {
      claimId,
      taskId: normalized.taskId,
      state,
      classification: "release_safe",
      reasons,
      claim: normalized,
      git: {
        branch,
        baseRef,
        branchExists: true,
        uniqueCommitCount: commitCount,
        ...(headSha ? { headSha } : {}),
      },
    };
  };

  if (action === "inspect") {
    const store = await readStore(rootDir, options.claimStorePath);
    return classify(store.claims.find((entry) => entry.id === claimId));
  }

  return updateStore(rootDir, options.claimStorePath, (store) => {
    const claim = store.claims.find((entry) => entry.id === claimId);
    const report = classify(claim);
    if (!claim) {
      return report;
    }
    if (action === "release") {
      if (report.classification !== "release_safe" && !options.force) {
        throw new TaskCommandError(
          "TASK_RECOVERY_UNSAFE_RELEASE",
          "Refusing to release a claim that is not classified as release_safe.",
          { claimId, classification: report.classification, reasons: report.reasons },
        );
      }
      claim.schemaVersion = "task-claim/v2";
      claim.git = report.claim?.git;
      claim.releasedAt = now.toISOString();
      claim.updatedAt = now.toISOString();
      return classify(claim);
    }
    if (action === "adopt") {
      if (report.classification !== "adopt_recommended" && !options.force) {
        throw new TaskCommandError(
          "TASK_RECOVERY_UNSAFE_ADOPT",
          "Refusing to adopt a claim that is not classified as adopt_recommended.",
          { claimId, classification: report.classification, reasons: report.reasons },
        );
      }
      const ttlMinutes = options.ttlMinutes ?? DEFAULT_TTL_MINUTES;
      claim.schemaVersion = "task-claim/v2";
      claim.git = report.claim?.git;
      claim.holder = normalizeHolder(options.holder);
      claim.updatedAt = now.toISOString();
      claim.expiresAt = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
      claim.recovery = {
        ...claim.recovery,
        adoptedAt: now.toISOString(),
      };
      delete claim.releasedAt;
      return classify(claim);
    }
    claim.schemaVersion = "task-claim/v2";
    claim.git = report.claim?.git;
    claim.updatedAt = now.toISOString();
    claim.recovery = {
      ...claim.recovery,
      abandonedAt: now.toISOString(),
      ...(options.reason ? { abandonedReason: options.reason } : {}),
    };
    return classify(claim);
  });
}

export async function getActiveClaimForTask(
  taskId: string,
  options: { rootDir?: string; claimStorePath?: string; now?: Date } = {},
): Promise<TaskClaim | undefined> {
  return (await getActiveClaimsForTask(taskId, options))[0];
}

export async function getActiveClaimsForTask(
  taskId: string,
  options: { rootDir?: string; claimStorePath?: string; now?: Date } = {},
): Promise<TaskClaim[]> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const now = options.now ?? new Date();
  const store = await readStore(rootDir, options.claimStorePath);
  return store.claims.filter(
    (claim) => claim.taskId === taskId && getState(claim, now) === "active",
  );
}

export async function getClaimStatusForTask(
  taskId: string,
  options: { rootDir?: string; claimStorePath?: string; now?: Date } = {},
): Promise<ClaimStatus | undefined> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const now = options.now ?? new Date();
  const store = await readStore(rootDir, options.claimStorePath);
  const claim = store.claims
    .filter((entry) => entry.taskId === taskId && !isReleased(entry))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
  if (!claim) {
    return undefined;
  }
  return {
    claimId: claim.id,
    taskId,
    state: getState(claim, now),
    claim,
  };
}
