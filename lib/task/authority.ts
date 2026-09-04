import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { openRepository } from "es-git";

export interface GitWorktreeEntry {
  readonly path: string;
  readonly branch?: string;
}

export type WorkItemRepositoryBranch =
  | { readonly state: "attached"; readonly name: string }
  | { readonly state: "detached" };

/**
 * Immutable local Git facts for one selected worktree. It intentionally does
 * not expose task, claim, runtime, or policy data.
 */
export interface WorkItemRepositoryWorktreeContext {
  readonly rootDir: string;
  readonly branch?: WorkItemRepositoryBranch;
  readonly worktrees: readonly GitWorktreeEntry[];
}

/** Reads the narrow local Git context used by task authority and readiness. */
export interface WorkItemRepositoryWorktreeContextReader {
  read(options?: { rootDir?: string; trace?: TaskAuthorityTrace }): Promise<WorkItemRepositoryWorktreeContext>;
}

export interface TaskAuthorityResolution {
  rootDir: string;
  source: "explicit-worktree" | "runtime-worktree" | "current-root";
  branch?: string;
}

export interface TaskAuthorityUnavailable {
  source: "runtime-worktree-unavailable";
  unavailable: {
    code: "runtime-worktree-invalid" | "runtime-worktree-not-registered";
    runtimeWorktree?: string;
  };
}

export type TaskAuthorityResolutionResult =
  | TaskAuthorityResolution
  | TaskAuthorityUnavailable;

/** @deprecated Use WorkItemRepositoryWorktreeContext. */
export type TaskAuthorityGitContext = WorkItemRepositoryWorktreeContext;
/** @deprecated Use WorkItemRepositoryWorktreeContext. */
export type TaskAuthorityGitContextSnapshot = WorkItemRepositoryWorktreeContext;

/** Test-only instrumentation for the task authority Git-context seam. */
export const TASK_AUTHORITY_TRACE_STAGES = [
  "gitRoot",
  "gitCurrentBranch",
  "gitWorktreeList",
  "policyResolution",
] as const;

export type TaskAuthorityTraceStage = (typeof TASK_AUTHORITY_TRACE_STAGES)[number];

export interface TaskAuthorityTraceStageTiming {
  durationMs: number;
  invocationCount: number;
  /** Direct Git CLI child-process invocations performed by this stage. */
  subprocessInvocationCount: number;
}

export interface TaskAuthorityTrace {
  stages: Record<TaskAuthorityTraceStage, TaskAuthorityTraceStageTiming>;
}

export function createTaskAuthorityTrace(): TaskAuthorityTrace {
  return {
    stages: Object.fromEntries(
      TASK_AUTHORITY_TRACE_STAGES.map((stage) => [
        stage,
        { durationMs: 0, invocationCount: 0, subprocessInvocationCount: 0 },
      ]),
    ) as Record<TaskAuthorityTraceStage, TaskAuthorityTraceStageTiming>,
  };
}

function traceTaskAuthorityStage<T>(
  trace: TaskAuthorityTrace | undefined,
  stage: TaskAuthorityTraceStage,
  operation: () => T,
): T {
  if (!trace) {
    return operation();
  }

  const startedAt = performance.now();
  try {
    return operation();
  } finally {
    const timing = trace.stages[stage];
    timing.durationMs += performance.now() - startedAt;
    timing.invocationCount += 1;
  }
}

function gitOutput(
  rootDir: string,
  args: string[],
  trace?: TaskAuthorityTrace,
  stage?: TaskAuthorityTraceStage,
): string | undefined {
  if (trace && stage) {
    trace.stages[stage].subprocessInvocationCount += 1;
  }
  try {
    return execFileSync("git", args, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function freezeContext(context: {
  rootDir: string;
  branch?: WorkItemRepositoryBranch;
  worktrees: GitWorktreeEntry[];
}): WorkItemRepositoryWorktreeContext {
  const worktrees = context.worktrees
    .map((worktree) => Object.freeze({ ...worktree }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return Object.freeze({
    rootDir: context.rootDir,
    ...(context.branch ? { branch: Object.freeze({ ...context.branch }) } : {}),
    worktrees: Object.freeze(worktrees),
  });
}

function parseCliWorktrees(output: string | undefined): GitWorktreeEntry[] {
  if (!output) {
    return [];
  }
  const entries: GitWorktreeEntry[] = [];
  let current: { path: string; branch?: string } | undefined;
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) {
        entries.push(current);
      }
      current = { path: path.resolve(line.slice("worktree ".length)) };
    } else if (current && line.startsWith("branch refs/heads/")) {
      current.branch = line.slice("branch refs/heads/".length);
    }
  }
  if (current) {
    entries.push(current);
  }
  return entries;
}

function cliContext(rootDir: string, trace?: TaskAuthorityTrace): WorkItemRepositoryWorktreeContext {
  const startingDir = path.resolve(rootDir);
  const gitRoot = traceTaskAuthorityStage(trace, "gitRoot", () =>
    gitOutput(startingDir, ["rev-parse", "--show-toplevel"], trace, "gitRoot"),
  );
  if (!gitRoot) {
    return freezeContext({ rootDir: startingDir, worktrees: [] });
  }
  const selectedRoot = path.resolve(gitRoot);
  const currentBranch = traceTaskAuthorityStage(trace, "gitCurrentBranch", () =>
    gitOutput(selectedRoot, ["branch", "--show-current"], trace, "gitCurrentBranch"),
  );
  const branch: WorkItemRepositoryBranch = currentBranch
    ? { state: "attached", name: currentBranch }
    : { state: "detached" };
  const worktrees = traceTaskAuthorityStage(trace, "gitWorktreeList", () =>
    parseCliWorktrees(
      gitOutput(
        selectedRoot,
        ["worktree", "list", "--porcelain"],
        trace,
        "gitWorktreeList",
      ),
    ),
  );
  if (!worktrees.some((worktree) => worktree.path === selectedRoot)) {
    worktrees.push({
      path: selectedRoot,
      ...(branch.state === "attached" ? { branch: branch.name } : {}),
    });
  }
  return freezeContext({ rootDir: selectedRoot, branch, worktrees });
}

/** Injectable default reader that preserves the existing Git CLI behavior. */
export const cliWorkItemRepositoryWorktreeContextReader: WorkItemRepositoryWorktreeContextReader = {
  async read(options = {}) {
    return cliContext(options.rootDir ?? process.cwd(), options.trace);
  },
};

function branchFromRepository(repository: Awaited<ReturnType<typeof openRepository>>): WorkItemRepositoryBranch {
  if (repository.headDetached()) {
    return { state: "detached" };
  }
  const name = repository.head().shorthand();
  return name ? { state: "attached", name } : { state: "detached" };
}

/** LibGit2-backed reader for callers that opt into es-git. */
export const esGitWorkItemRepositoryWorktreeContextReader: WorkItemRepositoryWorktreeContextReader = {
  async read(options = {}) {
    const startingDir = path.resolve(options.rootDir ?? process.cwd());
    let repository: Awaited<ReturnType<typeof openRepository>>;
    try {
      repository = await traceTaskAuthorityStage(options.trace, "gitRoot", () =>
        openRepository(startingDir),
      );
    } catch {
      return freezeContext({ rootDir: startingDir, worktrees: [] });
    }
    const selectedRoot = path.resolve(repository.workdir() ?? startingDir);
    const branch = traceTaskAuthorityStage(options.trace, "gitCurrentBranch", () =>
      branchFromRepository(repository),
    );
    let worktreeInventoryRepository = repository;
    if (repository.isWorktree()) {
      try {
        worktreeInventoryRepository = await openRepository(
          path.resolve(repository.path(), "..", ".."),
        );
      } catch {
        // The selected worktree still provides the only safe local fact.
      }
    }
    const worktreePaths = traceTaskAuthorityStage(options.trace, "gitWorktreeList", () => {
      const inventoryRoot = path.resolve(
        worktreeInventoryRepository.workdir() ?? selectedRoot,
      );
      const linked = worktreeInventoryRepository
        .worktrees()
        .map((name) => worktreeInventoryRepository.findWorktree(name).path());
      return [
        ...new Set([
          selectedRoot,
          inventoryRoot,
          ...linked.map((entry) => path.resolve(entry)),
        ]),
      ];
    });
    const worktrees = await Promise.all(
      worktreePaths.map(async (worktreePath) => {
        if (worktreePath === selectedRoot) {
          return {
            path: worktreePath,
            ...(branch.state === "attached" ? { branch: branch.name } : {}),
          };
        }
        try {
          const worktreeRepository = await openRepository(worktreePath);
          const worktreeBranch = branchFromRepository(worktreeRepository);
          return {
            path: worktreePath,
            ...(worktreeBranch.state === "attached" ? { branch: worktreeBranch.name } : {}),
          };
        } catch {
          return { path: worktreePath };
        }
      }),
    );
    return freezeContext({ rootDir: selectedRoot, branch, worktrees });
  },
};

/** LibGit2 is the default; CLI remains injectable and has no user-facing selector. */
export const defaultWorkItemRepositoryWorktreeContextReader =
  esGitWorkItemRepositoryWorktreeContextReader;

/**
 * Compatibility helper for callers outside the authority/ready paths. New
 * authority reads should use a WorkItemRepositoryWorktreeContextReader.
 */
export function resolveGitRoot(rootDir?: string): string {
  const startingDir = path.resolve(rootDir ?? process.cwd());
  return path.resolve(gitOutput(startingDir, ["rev-parse", "--show-toplevel"]) ?? startingDir);
}

/** Reads an immutable context with the default LibGit2 adapter. */
export async function readTaskAuthorityGitContext(
  rootDir?: string,
  trace?: TaskAuthorityTrace,
): Promise<TaskAuthorityGitContextSnapshot> {
  return defaultWorkItemRepositoryWorktreeContextReader.read({ rootDir, trace });
}

function canonicalWorktreePath(value: string): string {
  const resolved = path.resolve(value);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function registeredRuntimeWorktree(
  worktrees: readonly GitWorktreeEntry[],
  runtimeWorktree: string,
): GitWorktreeEntry | undefined {
  const candidatePath = canonicalWorktreePath(runtimeWorktree);
  return worktrees.find(
    (worktree) => canonicalWorktreePath(worktree.path) === candidatePath,
  );
}

/**
 * Pure authority policy. Runtime worktree metadata is the only locator for a
 * subsequent worktree; branch and task ID are never used to derive one.
 */
export function resolveTaskAuthorityFromGitContext(
  options: {
    rootDir: string;
    /** Retained for source compatibility; intentionally not used as a locator. */
    taskId?: string;
    runtimeBranch?: string;
    runtimeWorktree?: string;
    runtimeWorktreeInvalid?: boolean;
    worktree?: string;
  },
  context: TaskAuthorityGitContext,
  trace?: TaskAuthorityTrace,
): TaskAuthorityResolutionResult {
  return traceTaskAuthorityStage(trace, "policyResolution", () => {
    const rootDir = path.resolve(options.rootDir);
    if (options.worktree) {
      return {
        rootDir,
        source: "explicit-worktree",
        ...(context.branch?.state === "attached" ? { branch: context.branch.name } : {}),
      };
    }
    if (options.runtimeWorktreeInvalid) {
      return {
        source: "runtime-worktree-unavailable",
        unavailable: { code: "runtime-worktree-invalid" },
      };
    }
    if (options.runtimeWorktree?.trim()) {
      const registeredWorktree = registeredRuntimeWorktree(
        context.worktrees,
        options.runtimeWorktree,
      );
      if (!registeredWorktree) {
        return {
          source: "runtime-worktree-unavailable",
          unavailable: {
            code: "runtime-worktree-not-registered",
            runtimeWorktree: path.resolve(options.runtimeWorktree),
          },
        };
      }
      return {
        rootDir: registeredWorktree.path,
        source: "runtime-worktree",
        ...(registeredWorktree.branch ? { branch: registeredWorktree.branch } : {}),
      };
    }
    return {
      rootDir,
      source: "current-root",
      ...(context.branch?.state === "attached" ? { branch: context.branch.name } : {}),
    };
  });
}

/** Reads once through the selected reader, then applies pure authority policy. */
export async function resolveTaskAuthority(options: {
  rootDir?: string;
  taskId?: string;
  runtimeBranch?: string;
  runtimeWorktree?: string;
  runtimeWorktreeInvalid?: boolean;
  worktree?: string;
  trace?: TaskAuthorityTrace;
  reader?: WorkItemRepositoryWorktreeContextReader;
}): Promise<TaskAuthorityResolutionResult> {
  const context = await (options.reader ?? defaultWorkItemRepositoryWorktreeContextReader).read({
    rootDir: options.worktree ?? options.rootDir,
    trace: options.trace,
  });
  return resolveTaskAuthorityFromGitContext(
    {
      rootDir: context.rootDir,
      taskId: options.taskId,
      runtimeBranch: options.runtimeBranch,
      runtimeWorktree: options.runtimeWorktree,
      runtimeWorktreeInvalid: options.runtimeWorktreeInvalid,
      worktree: options.worktree,
    },
    context,
    options.trace,
  );
}
