import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import type { TaskRuntimeReadiness } from "./runtime.js";

export interface GitChangedPathEntry {
  path: string;
  status: string;
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
  dirtyPaths: GitChangedPathEntry[];
  unmergedPaths: GitChangedPathEntry[];
  taskPathDirty: boolean;
  resumeBlockedReasons: string[];
  resumeWarnings: string[];
}

const DEFAULT_MERGE_TARGET_CANDIDATES = [
  "main",
  "master",
  "origin/main",
  "origin/master",
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
    .filter((entry) => entry.length > 0);
}

function isUnmergedStatus(status: string): boolean {
  return (
    status.includes("U") ||
    status === "AA" ||
    status === "DD"
  );
}

export function collectTaskRecoveryGitState(options: {
  rootDir: string;
  taskFilePath: string;
  expectedBranch?: string;
  expectedWorktree?: string;
}): TaskRecoveryGitState {
  const currentWorktree = normalizeWorktreePath(options.rootDir);
  const expectedWorktree = options.expectedWorktree
    ? normalizeWorktreePath(options.expectedWorktree, options.rootDir)
    : undefined;
  const branch = currentBranch(options.rootDir);
  const dirtyPaths = collectChangedPaths(options.rootDir);
  const unmergedPaths = dirtyPaths.filter((entry) => isUnmergedStatus(entry.status));
  const mergeInProgress = gitPathExists(options.rootDir, "MERGE_HEAD");
  const rebaseInProgress =
    gitPathExists(options.rootDir, "rebase-merge") ||
    gitPathExists(options.rootDir, "rebase-apply");
  const branchLineageKnown = Boolean(
    options.expectedBranch &&
    branch &&
    options.expectedBranch === branch,
  );
  const worktreeLineageKnown = Boolean(
    expectedWorktree && expectedWorktree === currentWorktree,
  );
  const lineageKnown = branchLineageKnown || worktreeLineageKnown;
  const branchMatches =
    !options.expectedBranch ||
    !branch ||
    branch === options.expectedBranch;
  const worktreeMatches =
    !expectedWorktree || expectedWorktree === currentWorktree;
  const taskPathDirty = dirtyPaths.some((entry) => entry.path === options.taskFilePath);
  const resumeBlockedReasons = [
    ...(branchMatches ? [] : ["branch-mismatch"]),
    ...(worktreeMatches ? [] : ["worktree-mismatch"]),
    ...(mergeInProgress ? ["merge-in-progress"] : []),
    ...(rebaseInProgress ? ["rebase-in-progress"] : []),
    ...(unmergedPaths.length > 0 ? ["unmerged-paths"] : []),
  ];
  const resumeWarnings = [
    ...(!lineageKnown ? ["lineage-unknown"] : []),
    ...(options.expectedBranch && !branch ? ["current-branch-unknown"] : []),
  ];

  return {
    ...(branch ? { currentBranch: branch } : {}),
    ...(options.expectedBranch ? { expectedBranch: options.expectedBranch } : {}),
    currentWorktree,
    ...(expectedWorktree ? { expectedWorktree } : {}),
    lineageKnown,
    branchLineageKnown,
    worktreeLineageKnown,
    branchMatches,
    worktreeMatches,
    mergeInProgress,
    rebaseInProgress,
    dirtyPaths,
    unmergedPaths,
    taskPathDirty,
    resumeBlockedReasons,
    resumeWarnings,
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
