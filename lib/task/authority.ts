import { execFileSync } from "node:child_process";
import path from "node:path";

export interface GitWorktreeEntry {
  path: string;
  branch?: string;
}

export interface TaskAuthorityResolution {
  rootDir: string;
  source:
    | "explicit-worktree"
    | "current-worktree"
    | "branch-worktree"
    | "current-root";
  branch?: string;
}

export interface TaskAuthorityGitContext {
  currentBranch?: string;
  worktrees: GitWorktreeEntry[];
}

function gitOutput(rootDir: string, args: string[]): string | undefined {
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

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function resolveGitRoot(rootDir?: string): string {
  const startingDir = path.resolve(rootDir ?? process.cwd());
  const topLevel = gitOutput(startingDir, ["rev-parse", "--show-toplevel"]);
  return topLevel ? path.resolve(topLevel) : startingDir;
}

export function currentGitBranch(rootDir: string): string | undefined {
  const branch = gitOutput(rootDir, ["branch", "--show-current"]);
  return branch || undefined;
}

export function listGitWorktrees(rootDir: string): GitWorktreeEntry[] {
  const output = gitOutput(rootDir, ["worktree", "list", "--porcelain"]);
  if (!output) {
    return [];
  }

  const entries: GitWorktreeEntry[] = [];
  let current: GitWorktreeEntry | undefined;
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) {
        entries.push(current);
      }
      current = { path: path.resolve(line.slice("worktree ".length)) };
      continue;
    }
    if (current && line.startsWith("branch refs/heads/")) {
      current.branch = line.slice("branch refs/heads/".length);
    }
  }
  if (current) {
    entries.push(current);
  }
  return entries;
}

export function taskNumberFromTaskId(taskId: string): string | undefined {
  return taskId.match(/^wi-(\d+)/)?.[1] ?? taskId.match(/^(\d+)/)?.[1];
}

export function taskAuthorityBranchCandidates(options: {
  taskId: string;
  runtimeBranch?: string;
}): string[] {
  const numericId = taskNumberFromTaskId(options.taskId);
  return uniqueStrings([
    options.runtimeBranch,
    numericId ? `sandcastle/issue-${numericId}` : undefined,
  ]);
}

function findSingleBranchWorktree(
  worktrees: readonly GitWorktreeEntry[],
  branch: string,
): GitWorktreeEntry | undefined {
  const matches = worktrees.filter((entry) => entry.branch === branch);
  return matches.length === 1 ? matches[0] : undefined;
}

export function resolveTaskAuthority(options: {
  rootDir?: string;
  taskId: string;
  runtimeBranch?: string;
  worktree?: string;
}): TaskAuthorityResolution {
  if (options.worktree) {
    return {
      rootDir: resolveGitRoot(options.worktree),
      source: "explicit-worktree",
    };
  }

  const rootDir = resolveGitRoot(options.rootDir);
  return resolveTaskAuthorityFromGitContext(
    {
      rootDir,
      taskId: options.taskId,
      runtimeBranch: options.runtimeBranch,
    },
    {
      currentBranch: currentGitBranch(rootDir),
      worktrees: listGitWorktrees(rootDir),
    },
  );
}

export function resolveTaskAuthorityFromGitContext(
  options: {
    rootDir: string;
    taskId: string;
    runtimeBranch?: string;
  },
  context: TaskAuthorityGitContext,
): TaskAuthorityResolution {
  const rootDir = path.resolve(options.rootDir);
  const branchCandidates = taskAuthorityBranchCandidates({
    taskId: options.taskId,
    runtimeBranch: options.runtimeBranch,
  });
  const currentBranch = context.currentBranch;
  if (currentBranch && branchCandidates.includes(currentBranch)) {
    return {
      rootDir,
      source: "current-worktree",
      branch: currentBranch,
    };
  }

  for (const branch of branchCandidates) {
    const worktree = findSingleBranchWorktree(context.worktrees, branch);
    if (worktree) {
      return {
        rootDir: worktree.path,
        source: "branch-worktree",
        branch,
      };
    }
  }

  return {
    rootDir,
    source: "current-root",
    ...(currentBranch ? { branch: currentBranch } : {}),
  };
}
