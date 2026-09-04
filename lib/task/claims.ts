import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  acquireClaimAuthorityRuntimeClaim,
  adoptExpiredClaimAuthorityClaimByToken,
  inspectExpiredTaskClaimLineage,
  type ExpiredTaskLineageTrace,
  listClaimAuthorityClaims,
  loadClaimAuthorityClaimByTarget,
  lookupClaimAuthorityClaimByTarget,
  lookupClaimAuthorityClaimByToken,
  releaseClaimAuthorityClaimByToken,
  releaseExpiredClaimAuthorityClaimByToken,
} from "../claim/index.js";
import { RUNTIME_SCHEMA_VERSION, type RuntimeClaimRecord } from "../runtime/index.js";
import { TaskCommandError } from "./errors.js";
import { loadTaskModel } from "./model.js";
import { collectBranchDiffPaths, collectChangedPaths } from "./recovery-state.js";
import { classifyOperationalArtifact } from "../operational-artifacts.js";

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
  git?: TaskClaimGitContext;
  recovery?: TaskClaimRecoveryContext;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  lastHeartbeatAt?: string;
  releasedAt?: string;
}

export interface ClaimStatus {
  claimId: string;
  taskId?: string;
  state: ClaimState;
  claim?: TaskClaim;
}

export interface ClaimTaskOptions {
  rootDir?: string;
  /** @deprecated Retained for source compatibility; Claim-pack is authoritative. */
  claimStorePath?: string;
  holder?: string;
  branch?: string;
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
  /** @deprecated Retained for source compatibility; Claim-pack is authoritative. */
  claimStorePath?: string;
  now?: Date;
  action?: "inspect" | "release" | "adopt" | "abandon";
  holder?: string;
  ttlMinutes?: number;
  reason?: string;
  force?: boolean;
  /** Optional observation hook for the fixed Claim-pack lineage inspection. */
  lineageTrace?: ExpiredTaskLineageTrace;
}

const DEFAULT_TTL_MINUTES = 240;

function normalizeClaimLockPath(rootDir: string, filePath: string): string {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(rootDir, filePath);
  return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}

function isGitRepository(rootDir: string): boolean {
  try {
    return execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() === "true";
  } catch {
    return false;
  }
}

/**
 * Public Claim acquisition must use the same initial coverage as the CLI.
 * A generic non-Work target may legitimately have no paths; a resolved Work
 * Item may not silently become a zero-lock claim.
 */
async function deriveInitialClaimLockPaths(
  rootDir: string,
  taskId: string,
): Promise<string[]> {
  let task: Awaited<ReturnType<typeof loadTaskModel>>;
  try {
    task = await loadTaskModel(taskId, { rootDir });
  } catch (error) {
    // Retain the public Claim-pack API for non-Work task identifiers. A
    // malformed or ambiguous Work Item must fail rather than become a
    // zero-lock Claim.
    if (error instanceof TaskCommandError && error.code === "TASK_NOT_FOUND") {
      return [];
    }
    throw error;
  }

  const paths = new Set<string>([
    normalizeClaimLockPath(rootDir, task.filePath),
  ]);
  if (isGitRepository(rootDir)) {
    for (const changedPath of collectBranchDiffPaths(rootDir)) {
      if (classifyOperationalArtifact(changedPath).kind !== "operational") {
        paths.add(changedPath);
      }
    }
    for (const changedPath of collectChangedPaths(rootDir)) {
      if (classifyOperationalArtifact(changedPath.path).kind !== "operational") {
        paths.add(changedPath.path);
      }
    }
  }
  const initialLockPaths = [...paths].filter(Boolean).sort();
  if (initialLockPaths.length === 0) {
    throw new TaskCommandError(
      "TASK_CLAIM_COVERAGE_REQUIRED",
      `Task '${taskId}' requires initial Work path coverage.`,
      { taskId },
    );
  }
  return initialLockPaths;
}

function normalizeHolder(holder: string | undefined): string {
  const value = holder?.trim();
  if (value) {
    return value;
  }
  return process.env.USER ?? process.env.USERNAME ?? "local-agent";
}

function runtimeClaimMetadataToTaskClaimContext(
  metadata: RuntimeClaimRecord["metadata"],
): {
  branch?: string;
  git?: TaskClaimGitContext;
} {
  if (!metadata) {
    return {};
  }

  const context: {
    branch?: string;
    git?: TaskClaimGitContext;
  } = {};
  if (typeof metadata.branch === "string") {
    context.branch = metadata.branch;
  }
  const git: TaskClaimGitContext = {
    ...(typeof metadata.branch === "string" ? { branch: metadata.branch } : {}),
    ...(typeof metadata.baseRef === "string" ? { baseRef: metadata.baseRef } : {}),
    ...(typeof metadata.headRef === "string" ? { headRef: metadata.headRef } : {}),
    ...(typeof metadata.headSha === "string" ? { headSha: metadata.headSha } : {}),
    ...(typeof metadata.worktree === "string" ? { worktreePath: metadata.worktree } : {}),
  };
  if (Object.keys(git).length > 0) {
    context.git = git;
  }
  if (typeof metadata.git === "object" && metadata.git !== null) {
    context.git = metadata.git as TaskClaimGitContext;
  }
  return context;
}

function runtimeClaimStatusToTaskClaim(
  claim: RuntimeClaimRecord | undefined,
): ClaimStatus | undefined {
  if (!claim || claim.target_type !== "task") {
    return undefined;
  }
  const taskClaim: TaskClaim = {
    id: claim.claim_token,
    taskId: claim.target_id,
    holder: claim.holder,
    schemaVersion: "task-claim/v2",
    ...runtimeClaimMetadataToTaskClaimContext(claim.metadata),
    createdAt: claim.created_at,
    updatedAt: claim.last_seen_at ?? claim.created_at,
    expiresAt: claim.expires_at,
  };
  return {
    claimId: claim.claim_token,
    taskId: claim.target_id,
    state: claim.state,
    claim: taskClaim,
  };
}

/**
 * Create a task-claim response from the runtime Claim-pack authority. The
 * deprecated JSON-store options remain accepted for callers but have no
 * authority effect.
 */
export async function claimTask(
  taskId: string,
  options: ClaimTaskOptions = {},
): Promise<ClaimStatus> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const now = options.now ?? new Date();
  const ttlMinutes = options.ttlMinutes ?? DEFAULT_TTL_MINUTES;
  const initialLockPaths = await deriveInitialClaimLockPaths(rootDir, taskId);
  const acquisition = acquireClaimAuthorityRuntimeClaim({
    rootDir,
    seed: {
      schema_version: RUNTIME_SCHEMA_VERSION,
      target_type: "task",
      target_id: taskId,
      holder: normalizeHolder(options.holder),
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
      metadata: {
        ...(options.branch ? { branch: options.branch } : {}),
        ...(options.baseRef ? { baseRef: options.baseRef } : {}),
        ...(options.headRef ? { headRef: options.headRef } : {}),
        ...(options.headSha ? { headSha: options.headSha } : {}),
        ...(options.worktreePath ? { worktree: options.worktreePath } : {}),
      },
      entropy: randomUUID(),
    },
    initialLockPaths,
  });
  if (acquisition.outcome !== "acquired") {
    const existing = loadClaimAuthorityClaimByTarget({
      rootDir,
      targetType: "task",
      targetId: taskId,
    });
    throw new TaskCommandError(
      existing?.state === "expired" ? "TASK_CLAIM_EXPIRED" : "TASK_CLAIM_CONFLICT",
      `Task '${taskId}' already has a runtime Claim.`,
      { taskId, conflicts: acquisition.conflicts },
    );
  }
  return runtimeClaimStatusToTaskClaim(acquisition.claim) ?? {
    claimId: acquisition.claimToken,
    taskId,
    state: "missing",
  };
}

function unavailableClaimAuthority(rootDir: string): never {
  throw new TaskCommandError(
    "CLAIM_AUTHORITY_UNAVAILABLE",
    `Runtime claim authority is unavailable for repository '${rootDir}'.`,
    { rootDir },
  );
}

function releasedTaskClaim(claim: TaskClaim, now: Date): TaskClaim {
  return {
    ...claim,
    updatedAt: now.toISOString(),
    releasedAt: now.toISOString(),
  };
}

/**
 * Task response projection only. The runtime Claim pack is the sole authority;
 * local task-claim JSON is deliberately not consulted by this operation.
 */
export async function getClaimStatus(
  claimId: string,
  options: { rootDir?: string; claimStorePath?: string; now?: Date } = {},
): Promise<ClaimStatus> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const lookup = lookupClaimAuthorityClaimByToken({ rootDir, claimToken: claimId });
  if (lookup.authority === "unavailable") {
    return unavailableClaimAuthority(rootDir);
  }
  return runtimeClaimStatusToTaskClaim(lookup.claim) ?? { claimId, state: "missing" };
}

/**
 * Release the exact authoritative Claim token. This does not write a local
 * task-claim projection, so subsequent status is correctly authoritative.
 */
export async function releaseClaim(
  claimId: string,
  options: { rootDir?: string; claimStorePath?: string; now?: Date } = {},
): Promise<ClaimStatus> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const now = options.now ?? new Date();
  const release = releaseClaimAuthorityClaimByToken({ rootDir, claimToken: claimId });
  if (release.outcome === "unavailable") {
    return unavailableClaimAuthority(rootDir);
  }
  if (release.outcome === "missing" || release.claim.target_type !== "task") {
    return { claimId, state: "missing" };
  }
  const projected = runtimeClaimStatusToTaskClaim(release.claim);
  if (!projected?.claim) {
    return { claimId, state: "missing" };
  }
  return {
    claimId,
    taskId: projected.taskId,
    state: "released",
    claim: releasedTaskClaim(projected.claim, now),
  };
}

/** List current task Claims from the runtime Claim-pack authority. */
export async function listTaskClaims(
  options: { rootDir?: string; claimStorePath?: string; now?: Date } = {},
): Promise<ClaimStatus[]> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const lookup = listClaimAuthorityClaims({ rootDir });
  if (lookup.authority === "unavailable") {
    return unavailableClaimAuthority(rootDir);
  }
  return lookup.claims
    .map(runtimeClaimStatusToTaskClaim)
    .filter((status): status is ClaimStatus => status !== undefined);
}

function lineageToRecoveryReport(
  claimId: string,
  lineage: Awaited<ReturnType<typeof inspectExpiredTaskClaimLineage>>,
): ClaimRecoveryReport {
  if (lineage.outcome === "authoritative") {
    return {
      claimId,
      taskId: lineage.taskId,
      state: "expired",
      classification: lineage.classification,
      reasons: [
        lineage.classification === "release_safe"
          ? "expired_claim_branch_has_no_unique_commits"
          : "expired_claim_branch_has_unique_commits",
      ],
      git: {
        branch: lineage.git.branch,
        baseRef: lineage.git.baseRef,
        worktreePath: lineage.git.worktreePath,
        branchExists: true,
        uniqueCommitCount: lineage.git.aheadCount,
      },
    };
  }
  return {
    claimId,
    state: lineage.reason === "claim_missing" ? "missing" : "expired",
    classification: "manual_review_required",
    reasons: [lineage.reason],
  };
}

/**
 * Recover only through Claim-pack lineage and runtime records. In particular,
 * claimStorePath remains a compatibility option but is never read or written
 * here: a task-claim JSON file cannot authorize recovery.
 */
export async function recoverClaim(
  claimId: string,
  options: RecoverClaimOptions = {},
): Promise<ClaimRecoveryReport> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const now = options.now ?? new Date();
  const action = options.action ?? "inspect";
  const lineage = await inspectExpiredTaskClaimLineage({
    rootDir,
    claimToken: claimId,
    trace: options.lineageTrace,
  });
  const report = lineageToRecoveryReport(claimId, lineage);

  if (action === "inspect") {
    return report;
  }
  if (report.classification === "manual_review_required") {
    throw new TaskCommandError(
      "TASK_RECOVERY_MANUAL_REVIEW_REQUIRED",
      "Refusing to recover a Claim whose authoritative lineage requires manual review.",
      { claimId, reasons: report.reasons },
    );
  }

  if (action === "release") {
    if (report.classification !== "release_safe") {
      throw new TaskCommandError(
        "TASK_RECOVERY_UNSAFE_RELEASE",
        "Refusing to release a Claim that is not classified as release_safe.",
        { claimId, classification: report.classification, reasons: report.reasons },
      );
    }
    if (lineage.outcome !== "authoritative") {
      throw new TaskCommandError(
        "TASK_RECOVERY_UNSAFE_RELEASE",
        "Refusing to release a Claim without authoritative expired lineage.",
        { claimId },
      );
    }
    const release = releaseExpiredClaimAuthorityClaimByToken({
      rootDir,
      claimToken: claimId,
      expectedExpiresAt: lineage.claimExpiresAt,
    });
    if (release.outcome === "unavailable") {
      return unavailableClaimAuthority(rootDir);
    }
    if (release.outcome === "condition-not-met") {
      throw new TaskCommandError(
        "TASK_RECOVERY_UNSAFE_RELEASE",
        "Refusing to release a Claim that changed after lineage inspection.",
        { claimId, state: release.claim.state, expiresAt: release.claim.expires_at },
      );
    }
    if (release.outcome === "missing" || release.claim.target_type !== "task") {
      return {
        claimId,
        state: "missing",
        classification: "manual_review_required",
        reasons: ["claim_missing"],
      };
    }
    const status = runtimeClaimStatusToTaskClaim(release.claim);
    return {
      claimId,
      taskId: release.claim.target_id,
      state: "released",
      classification: "terminal",
      reasons: ["claim_released"],
      ...(status?.claim ? { claim: releasedTaskClaim(status.claim, now) } : {}),
    };
  }

  if (action === "adopt") {
    if (report.classification !== "adopt_recommended") {
      throw new TaskCommandError(
        "TASK_RECOVERY_UNSAFE_ADOPT",
        "Refusing to adopt a Claim that is not classified as adopt_recommended.",
        { claimId, classification: report.classification, reasons: report.reasons },
      );
    }
    const adoption = adoptExpiredClaimAuthorityClaimByToken({
      rootDir,
      claimToken: claimId,
      ttlMilliseconds: (options.ttlMinutes ?? DEFAULT_TTL_MINUTES) * 60_000,
    });
    if (adoption.outcome === "unavailable") {
      return unavailableClaimAuthority(rootDir);
    }
    if (adoption.outcome === "missing") {
      return {
        claimId,
        state: "missing",
        classification: "manual_review_required",
        reasons: ["claim_missing"],
      };
    }
    if (adoption.outcome === "not-expired") {
      throw new TaskCommandError(
        "TASK_RECOVERY_UNSAFE_ADOPT",
        "Refusing to adopt a Claim that is no longer expired.",
        { claimId },
      );
    }
    const status = runtimeClaimStatusToTaskClaim(adoption.claim);
    return {
      claimId,
      taskId: adoption.claim.target_id,
      state: status?.state ?? "active",
      classification: "manual_review_required",
      reasons: ["claim_active"],
      ...(status?.claim ? { claim: status.claim } : {}),
    };
  }

  // Abandon is an explicit operator decision. It releases the exact authority
  // record, then maps that terminal decision to the historical task shape.
  const release = releaseClaimAuthorityClaimByToken({ rootDir, claimToken: claimId });
  if (release.outcome === "unavailable") {
    return unavailableClaimAuthority(rootDir);
  }
  if (release.outcome === "missing" || release.claim.target_type !== "task") {
    return {
      claimId,
      state: "missing",
      classification: "manual_review_required",
      reasons: ["claim_missing"],
    };
  }
  const status = runtimeClaimStatusToTaskClaim(release.claim);
  return {
    claimId,
    taskId: release.claim.target_id,
    state: "abandoned",
    classification: "terminal",
    reasons: ["claim_abandoned"],
    ...(status?.claim ? {
      claim: {
        ...releasedTaskClaim(status.claim, now),
        recovery: {
          abandonedAt: now.toISOString(),
          ...(options.reason ? { abandonedReason: options.reason } : {}),
        },
      },
    } : {}),
  };
}

/**
 * Read the active task Claim only from the runtime Claim-pack authority.
 * `claimStorePath` and `now` remain compatibility options with no authority effect.
 */
export async function getActiveClaimForTask(
  taskId: string,
  options: { rootDir?: string; claimStorePath?: string; now?: Date } = {},
): Promise<TaskClaim | undefined> {
  return (await getActiveClaimsForTask(taskId, options))[0];
}

/** Return the current active task Claim from Claim-pack, if one exists. */
export async function getActiveClaimsForTask(
  taskId: string,
  options: { rootDir?: string; claimStorePath?: string; now?: Date } = {},
): Promise<TaskClaim[]> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const lookup = lookupClaimAuthorityClaimByTarget({
    rootDir,
    targetType: "task",
    targetId: taskId,
  });
  if (lookup.authority === "unavailable") {
    return unavailableClaimAuthority(rootDir);
  }
  const status = runtimeClaimStatusToTaskClaim(lookup.claim);
  return status?.state === "active" && status.claim ? [status.claim] : [];
}

/** Return the current task Claim status from Claim-pack, if one exists. */
export async function getClaimStatusForTask(
  taskId: string,
  options: { rootDir?: string; claimStorePath?: string; now?: Date } = {},
): Promise<ClaimStatus | undefined> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const lookup = lookupClaimAuthorityClaimByTarget({
    rootDir,
    targetType: "task",
    targetId: taskId,
  });
  if (lookup.authority === "unavailable") {
    return unavailableClaimAuthority(rootDir);
  }
  return runtimeClaimStatusToTaskClaim(lookup.claim);
}
