import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { openRepository, type Status } from "es-git";

export interface GitChangedPathEntry {
  path: string;
  status: string;
}

export type RecoverySafetyFact<T> =
  | { state: "ok"; value: T }
  | { state: "failed"; error: RecoverySafetyReadError }
  | { state: "not-read"; reason: "repository-unavailable" };

export interface RecoverySafetyReadError {
  operation: "status" | "branch" | "merge" | "rebase" | "branch-diff";
  message: string;
}

export interface TaskRecoverySafetyState {
  repository: { state: "available" } | { state: "unavailable" };
  status: RecoverySafetyFact<GitChangedPathEntry[]>;
  branch: RecoverySafetyFact<{ currentBranch?: string; detached: boolean }>;
  merge: RecoverySafetyFact<boolean>;
  rebase: RecoverySafetyFact<boolean>;
  branchDiff: RecoverySafetyFact<string[]>;
}

/** Reads only the Git facts that recovery needs to make a safety decision. */
export interface TaskRecoverySafetyStateReader {
  readSafetyState(options: { rootDir: string }): Promise<TaskRecoverySafetyState>;
}

const DEFAULT_MERGE_TARGET_CANDIDATES = [
  "origin/main",
  "origin/master",
  "main",
  "master",
  "HEAD",
] as const;

function unavailableSafetyState(): TaskRecoverySafetyState {
  const notRead = { state: "not-read", reason: "repository-unavailable" } as const;
  return {
    repository: { state: "unavailable" },
    status: notRead,
    branch: notRead,
    merge: notRead,
    rebase: notRead,
    branchDiff: notRead,
  };
}

function failure<T>(
  operation: RecoverySafetyReadError["operation"],
  error: unknown,
): RecoverySafetyFact<T> {
  return {
    state: "failed",
    error: {
      operation,
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function parseCliChangedPaths(output: string): GitChangedPathEntry[] {
  if (!output) {
    return [];
  }
  return output.split("\n").flatMap((line) => {
    const entry = line.trimEnd();
    if (!entry) {
      return [];
    }
    const status = entry.slice(0, 2);
    const rawPath = entry.slice(2).trim();
    const pathValue = rawPath.includes(" -> ")
      ? rawPath.split(" -> ").pop() ?? ""
      : rawPath;
    return pathValue ? [{ status, path: pathValue }] : [];
  });
}

function isUnmergedStatus(status: string): boolean {
  return status.includes("U") || status === "AA" || status === "DD";
}

function cliStatus(
  git: (args: string[]) => string,
): RecoverySafetyFact<GitChangedPathEntry[]> {
  try {
    return {
      state: "ok",
      value: parseCliChangedPaths(git(["status", "--porcelain=v1", "-uall"])),
    };
  } catch (error) {
    return failure("status", error);
  }
}

function cliBranch(
  git: (args: string[]) => string,
): RecoverySafetyFact<{ currentBranch?: string; detached: boolean }> {
  try {
    const currentBranch = git(["branch", "--show-current"]) || undefined;
    return {
      state: "ok",
      value: currentBranch ? { currentBranch, detached: false } : { detached: true },
    };
  } catch (error) {
    return failure("branch", error);
  }
}

function cliGitPathState(
  git: (args: string[]) => string,
  rootDir: string,
  gitPath: string,
  operation: "merge" | "rebase",
): RecoverySafetyFact<boolean> {
  try {
    const resolved = git(["rev-parse", "--git-path", gitPath]);
    try {
      statSync(path.resolve(rootDir, resolved));
      return { state: "ok", value: true };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      ) {
        return { state: "ok", value: false };
      }
      throw error;
    }
  } catch (error) {
    return failure(operation, error);
  }
}

function isMissingCliRef(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "status" in error && (error as { status?: unknown }).status === 1;
}

function cliBranchDiff(
  git: (args: string[]) => string,
): RecoverySafetyFact<string[]> {
  try {
    let mergeTarget: string | undefined;
    for (const candidate of DEFAULT_MERGE_TARGET_CANDIDATES) {
      try {
        git(["rev-parse", "--verify", "--quiet", candidate]);
        mergeTarget = candidate;
        break;
      } catch (error) {
        if (!isMissingCliRef(error)) {
          throw error;
        }
      }
    }
    if (!mergeTarget) {
      throw new Error("No merge-base candidate could be resolved.");
    }
    const output = git(["diff", "--name-only", `${mergeTarget}...HEAD`]);
    return {
      state: "ok",
      value: output.split("\n").map((entry) => entry.trim()).filter(Boolean),
    };
  } catch (error) {
    return failure("branch-diff", error);
  }
}

/** Creates the canonical CLI reader; production uses the default executable. */
export function createCliTaskRecoverySafetyStateReader(options: {
  gitExecutable?: string;
} = {}): TaskRecoverySafetyStateReader {
  const gitExecutable = options.gitExecutable ?? "git";
  const git = (rootDir: string) => (args: string[]): string =>
    execFileSync(gitExecutable, args, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  return {
    async readSafetyState({ rootDir }) {
      const runGit = git(rootDir);
      try {
        if (runGit(["rev-parse", "--is-inside-work-tree"]) !== "true") {
          return unavailableSafetyState();
        }
      } catch {
        return unavailableSafetyState();
      }
      return {
        repository: { state: "available" },
        status: cliStatus(runGit),
        branch: cliBranch(runGit),
        merge: cliGitPathState(runGit, rootDir, "MERGE_HEAD", "merge"),
        rebase: (() => {
          const merge = cliGitPathState(runGit, rootDir, "rebase-merge", "rebase");
          if (merge.state !== "ok" || merge.value) {
            return merge;
          }
          return cliGitPathState(runGit, rootDir, "rebase-apply", "rebase");
        })(),
        branchDiff: cliBranchDiff(runGit),
      };
    },
  };
}

/** Injectable CLI fallback for recovery safety checks. */
export const cliTaskRecoverySafetyStateReader =
  createCliTaskRecoverySafetyStateReader();

function esGitStatus(entry: Status): string {
  if (entry.conflicted) {
    return "UU";
  }
  if (entry.wtNew && !entry.indexNew) {
    return "??";
  }
  const index = entry.indexNew
    ? "A"
    : entry.indexModified
      ? "M"
      : entry.indexDeleted
        ? "D"
        : entry.indexRenamed
          ? "R"
          : entry.indexTypechange
            ? "T"
            : " ";
  const worktree = entry.wtNew
    ? "?"
    : entry.wtModified
      ? "M"
      : entry.wtDeleted
        ? "D"
        : entry.wtRenamed
          ? "R"
          : entry.wtTypechange
            ? "T"
            : " ";
  return `${index}${worktree}`;
}

function esGitBranchDiff(repository: Awaited<ReturnType<typeof openRepository>>): string[] {
  const head = repository.head();
  const headOid = head.target() ?? head.resolve().target();
  if (!headOid) {
    throw new Error("HEAD could not be resolved for branch diff.");
  }
  for (const candidate of DEFAULT_MERGE_TARGET_CANDIDATES) {
    let targetOid: string;
    try {
      targetOid = repository.revparseSingle(candidate);
    } catch (error) {
      if (
        error instanceof Error &&
        /code=NotFound/.test(error.message)
      ) {
        continue;
      }
      throw error;
    }
    const baseOid = repository.getMergeBase(targetOid, headOid);
    const diff = repository.diffTreeToTree(
      repository.getCommit(baseOid).tree(),
      repository.getCommit(headOid).tree(),
    );
    return [...diff.deltas()].flatMap((delta) => {
      const changedPath = delta.newFile().path() ?? delta.oldFile().path();
      return changedPath ? [changedPath] : [];
    });
  }
  throw new Error("No merge-base candidate could be resolved.");
}

/** Canonical LibGit2-backed production reader for recovery safety checks. */
export const esGitTaskRecoverySafetyStateReader: TaskRecoverySafetyStateReader = {
  async readSafetyState({ rootDir }) {
    let repository: Awaited<ReturnType<typeof openRepository>>;
    try {
      repository = await openRepository(rootDir);
    } catch {
      return unavailableSafetyState();
    }
    let status: RecoverySafetyFact<GitChangedPathEntry[]>;
    try {
      status = {
        state: "ok",
        value: [...repository.statuses().iter()].flatMap((entry) => {
          const entryStatus = entry.status();
          if (entryStatus.ignored) {
            return [];
          }
          return [{
            path: entry.path(),
            status: esGitStatus(entryStatus),
          }];
        }),
      };
    } catch (error) {
      status = failure("status", error);
    }
    let branch: RecoverySafetyFact<{ currentBranch?: string; detached: boolean }>;
    try {
      const detached = repository.headDetached();
      const currentBranch = detached ? undefined : repository.head().shorthand() || undefined;
      branch = {
        state: "ok",
        value: currentBranch ? { currentBranch, detached } : { detached },
      };
    } catch (error) {
      branch = failure("branch", error);
    }
    let merge: RecoverySafetyFact<boolean>;
    let rebase: RecoverySafetyFact<boolean>;
    try {
      const repositoryState = repository.state();
      merge = { state: "ok", value: repositoryState === "Merge" };
      rebase = {
        state: "ok",
        value:
          repositoryState === "Rebase" ||
          repositoryState === "RebaseInteractive" ||
          repositoryState === "RebaseMerge" ||
          repositoryState === "ApplyMailbox" ||
          repositoryState === "ApplyMailboxOrRebase",
      };
    } catch (error) {
      merge = failure("merge", error);
      rebase = failure("rebase", error);
    }
    let branchDiff: RecoverySafetyFact<string[]>;
    try {
      branchDiff = { state: "ok", value: esGitBranchDiff(repository) };
    } catch (error) {
      branchDiff = failure("branch-diff", error);
    }
    return {
      repository: { state: "available" },
      status,
      branch,
      merge,
      rebase,
      branchDiff,
    };
  },
};

export { isUnmergedStatus };
