import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { classifyOperationalArtifact } from "../operational-artifacts.js";
import type {
  GitChangedPathEntry,
  RecoverySafetyFact,
  TaskRecoverySafetyStateReader,
} from "./recovery-safety-state-reader.js";
import { esGitTaskRecoverySafetyStateReader } from "./recovery-safety-state-reader.js";
import { TaskCommandError } from "./errors.js";
import type { TaskRuntimeReadiness } from "./runtime.js";

export type { GitChangedPathEntry } from "./recovery-safety-state-reader.js";

export interface OperationalRecoveryArtifactDiagnostic {
  path: string;
  status: string;
  reason: "runtime-authority" | "agent-local";
}

export interface TaskRecoveryGitState {
  currentBranch?: string;
  expectedBranch?: string;
  currentWorktree: string;
  expectedWorktree?: string;
  lineageKnown: boolean;
  branchLineageKnown: boolean;
  worktreeLineageKnown: boolean;
  branchMatches: boolean;
  worktreeMatches: boolean;
  mergeInProgress: boolean;
  rebaseInProgress: boolean;
  /** Dirty paths that remain governed/recovery-relevant. */
  dirtyPaths: GitChangedPathEntry[];
  /** Allowlisted local artifacts excluded from recovery and lock decisions. */
  operationalArtifacts: OperationalRecoveryArtifactDiagnostic[];
  unmergedPaths: GitChangedPathEntry[];
  taskPathDirty: boolean;
  resumeBlockedReasons: string[];
  resumeWarnings: string[];
}

const DEFAULT_MERGE_TARGET_CANDIDATES = [
  "origin/main",
  "origin/master",
  "main",
  "master",
  "HEAD",
] as const;

function gitOutput(rootDir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function gitPathExists(rootDir: string, gitPath: string): boolean {
  try {
    const resolved = gitOutput(rootDir, ["rev-parse", "--git-path", gitPath]);
    return existsSync(path.resolve(rootDir, resolved));
  } catch {
    return false;
  }
}

function currentBranch(rootDir: string): string | undefined {
  try {
    const branch = gitOutput(rootDir, ["branch", "--show-current"]);
    return branch || undefined;
  } catch {
    return undefined;
  }
}

function normalizeWorktreePath(value: string, baseDir = process.cwd()): string {
  const resolved = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(baseDir, value);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function defaultMergeTargetRef(rootDir: string): string {
  for (const candidate of DEFAULT_MERGE_TARGET_CANDIDATES) {
    try {
      const output = gitOutput(rootDir, [
        "rev-parse",
        "--verify",
        "--quiet",
        candidate,
      ]);
      if (output) {
        return candidate;
      }
    } catch {
      continue;
    }
  }
  return "HEAD";
}

export function collectChangedPaths(rootDir: string): GitChangedPathEntry[] {
  let output: string;
  try {
    output = gitOutput(rootDir, ["status", "--porcelain=v1", "-uall"]);
  } catch {
    return [];
  }
  if (!output) {
    return [];
  }

  const entries: GitChangedPathEntry[] = [];
  for (const line of output.split("\n")) {
    const entry = line.trimEnd();
    if (!entry) {
      continue;
    }
    const status = entry.slice(0, 2);
    const rawPath = entry.slice(2).trim();
    const pathValue = rawPath.includes(" -> ")
      ? rawPath.split(" -> ").pop() ?? ""
      : rawPath;
    if (!pathValue) {
      continue;
    }
    entries.push({
      status,
      path: pathValue,
    });
  }
  return entries;
}

export function collectBranchDiffPaths(rootDir: string): string[] {
  const mergeTargetRef = defaultMergeTargetRef(rootDir);
  let output: string;
  try {
    output = gitOutput(rootDir, [
      "diff",
      "--name-only",
      `${mergeTargetRef}...HEAD`,
    ]);
  } catch {
    return [];
  }
  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .filter((entry) => classifyOperationalArtifact(entry).kind !== "operational");
}

function isUnmergedStatus(status: string): boolean {
  return (
    status.includes("U") ||
    status === "AA" ||
    status === "DD"
  );
}

interface RecoveryGitFacts {
  currentBranch?: string;
  dirtyPaths: GitChangedPathEntry[];
  mergeInProgress: boolean;
  rebaseInProgress: boolean;
  branchDiffPaths?: string[];
}

function normalizeTaskRecoveryGitState(
  options: {
    rootDir: string;
    taskFilePath: string;
    expectedBranch?: string;
    expectedWorktree?: string;
  },
  facts: RecoveryGitFacts,
): TaskRecoveryGitState {
  const currentWorktree = normalizeWorktreePath(options.rootDir);
  const expectedWorktree = options.expectedWorktree
    ? normalizeWorktreePath(options.expectedWorktree, options.rootDir)
    : undefined;
  const operationalArtifacts: OperationalRecoveryArtifactDiagnostic[] = [];
  const dirtyPaths = facts.dirtyPaths.filter((entry) => {
    const classification = classifyOperationalArtifact(entry.path);
    if (classification.kind !== "operational") {
      return true;
    }
    operationalArtifacts.push({
      path: classification.path,
      status: entry.status,
      reason: classification.reason,
    });
    return false;
  });
  const unmergedPaths = dirtyPaths.filter((entry) => isUnmergedStatus(entry.status));
  const branchLineageKnown = Boolean(
    options.expectedBranch &&
    facts.currentBranch &&
    options.expectedBranch === facts.currentBranch,
  );
  const worktreeLineageKnown = Boolean(
    expectedWorktree && expectedWorktree === currentWorktree,
  );
  const lineageKnown = branchLineageKnown || worktreeLineageKnown;
  const branchMatches =
    !options.expectedBranch ||
    !facts.currentBranch ||
    facts.currentBranch === options.expectedBranch;
  const worktreeMatches =
    !expectedWorktree || expectedWorktree === currentWorktree;
  const taskPathDirty = dirtyPaths.some((entry) => entry.path === options.taskFilePath);
  const resumeBlockedReasons = [
    ...(branchMatches ? [] : ["branch-mismatch"]),
    ...(worktreeMatches ? [] : ["worktree-mismatch"]),
    ...(facts.mergeInProgress ? ["merge-in-progress"] : []),
    ...(facts.rebaseInProgress ? ["rebase-in-progress"] : []),
    ...(unmergedPaths.length > 0 ? ["unmerged-paths"] : []),
  ];
  const resumeWarnings = [
    ...(!lineageKnown ? ["lineage-unknown"] : []),
    ...(options.expectedBranch && !facts.currentBranch ? ["current-branch-unknown"] : []),
  ];

  return {
    ...(facts.currentBranch ? { currentBranch: facts.currentBranch } : {}),
    ...(options.expectedBranch ? { expectedBranch: options.expectedBranch } : {}),
    currentWorktree,
    ...(expectedWorktree ? { expectedWorktree } : {}),
    lineageKnown,
    branchLineageKnown,
    worktreeLineageKnown,
    branchMatches,
    worktreeMatches,
    mergeInProgress: facts.mergeInProgress,
    rebaseInProgress: facts.rebaseInProgress,
    dirtyPaths,
    operationalArtifacts,
    unmergedPaths,
    taskPathDirty,
    resumeBlockedReasons,
    resumeWarnings,
  };
}

export function collectTaskRecoveryGitState(options: {
  rootDir: string;
  taskFilePath: string;
  expectedBranch?: string;
  expectedWorktree?: string;
}): TaskRecoveryGitState {
  return normalizeTaskRecoveryGitState(options, {
    currentBranch: currentBranch(options.rootDir),
    dirtyPaths: collectChangedPaths(options.rootDir),
    mergeInProgress: gitPathExists(options.rootDir, "MERGE_HEAD"),
    rebaseInProgress:
      gitPathExists(options.rootDir, "rebase-merge") ||
      gitPathExists(options.rootDir, "rebase-apply"),
  });
}

export class TaskRecoverySafetyStateError extends TaskCommandError {
  constructor(
    details: Record<string, unknown>,
    code:
      | "TASK_RECOVERY_GIT_REPOSITORY_UNAVAILABLE"
      | "TASK_RECOVERY_GIT_SAFETY_READ_FAILED" = "TASK_RECOVERY_GIT_SAFETY_READ_FAILED",
  ) {
    super(code, "Task recovery cannot complete Git safety checks.", details);
    this.name = "TaskRecoverySafetyStateError";
  }
}

function requireSafetyFact<T>(
  fact: string,
  result: RecoverySafetyFact<T>,
): T {
  if (result.state === "ok") {
    return result.value;
  }
  throw new TaskRecoverySafetyStateError({
    fact,
    ...(result.state === "failed" ? result.error : { reason: result.reason }),
  });
}

/**
 * Reads recovery's required safety facts through its dedicated reader. Unlike
 * legacy status helpers, this fails closed when any fact cannot be observed.
 */
export async function collectTaskRecoverySafetyGitState(options: {
  rootDir: string;
  taskFilePath: string;
  expectedBranch?: string;
  expectedWorktree?: string;
  reader?: TaskRecoverySafetyStateReader;
}): Promise<TaskRecoveryGitState & { branchDiffPaths: string[] }> {
  let safetyState;
  try {
    safetyState = await (
      options.reader ?? esGitTaskRecoverySafetyStateReader
    ).readSafetyState({ rootDir: options.rootDir });
  } catch (error) {
    throw new TaskRecoverySafetyStateError({
      fact: "reader",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (safetyState.repository.state !== "available") {
    throw new TaskRecoverySafetyStateError(
      { repository: safetyState.repository.state },
      "TASK_RECOVERY_GIT_REPOSITORY_UNAVAILABLE",
    );
  }
  const status = requireSafetyFact("status", safetyState.status);
  const branch = requireSafetyFact("branch", safetyState.branch);
  const merge = requireSafetyFact("merge", safetyState.merge);
  const rebase = requireSafetyFact("rebase", safetyState.rebase);
  const branchDiff = requireSafetyFact("branch-diff", safetyState.branchDiff);
  return {
    ...normalizeTaskRecoveryGitState(options, {
      currentBranch: branch.currentBranch,
      dirtyPaths: status,
      mergeInProgress: merge,
      rebaseInProgress: rebase,
      branchDiffPaths: branchDiff,
    }),
    branchDiffPaths: branchDiff.filter(
      (entry) => classifyOperationalArtifact(entry).kind !== "operational",
    ),
  };
}

export function isRecoverableReadyRuntimeState(options: {
  status: string;
  runtime?: TaskRuntimeReadiness;
  gitState: TaskRecoveryGitState;
  allowUncertainLineage?: boolean;
}): boolean {
  const latestExecutionLog = options.runtime?.latestExecutionLog;
  return (
    options.status === "ready" &&
    options.runtime?.markdownReady === true &&
    options.runtime.executionReady === false &&
    options.runtime.sourceDisagreement === true &&
    latestExecutionLog !== undefined &&
    latestExecutionLog.readyPermitting === false &&
    latestExecutionLog.claimState !== "active" &&
    (latestExecutionLog.lockCount ?? 0) === 0 &&
    options.gitState.resumeBlockedReasons.length === 0 &&
    (options.allowUncertainLineage || options.gitState.resumeWarnings.length === 0)
  );
}
