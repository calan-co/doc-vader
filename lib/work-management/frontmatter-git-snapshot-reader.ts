import { openRepository } from "es-git";

export const FRONTMATTER_GIT_SNAPSHOT_TRACE_STAGES = [
  "comparisonRefResolution",
  "changedSetRead",
  "historicalContentRead",
] as const;

export type FrontmatterGitSnapshotTraceStage =
  (typeof FRONTMATTER_GIT_SNAPSHOT_TRACE_STAGES)[number];

export interface FrontmatterGitSnapshotTrace {
  trace<T>(
    stage: FrontmatterGitSnapshotTraceStage,
    operation: () => Promise<T>,
  ): Promise<T>;
  recordOutcome(
    stage: FrontmatterGitSnapshotTraceStage,
    outcome: "value" | "unavailable",
  ): void;
}

/** Immutable Git facts used by frontmatter lint for one invocation. */
export interface FrontmatterGitSnapshot {
  readonly comparisonRef: string | null;
  /** Repository-relative paths matching `git diff --name-only <base> -- <backlog>`. */
  readonly changedPaths: readonly string[];
  /** Eager baseline blob reads for every supplied candidate path. */
  readonly historicalContents: Readonly<Record<string, string | null>>;
}

export interface ReadFrontmatterGitSnapshotOptions {
  rootDir: string;
  /** A repository-relative directory, or null when the configured root is outside the repository. */
  backlogRoot: string | null;
  /** Repository-relative paths whose baseline blobs must be captured eagerly. */
  candidatePaths: readonly string[];
  trace?: FrontmatterGitSnapshotTrace;
}

function safe<T>(operation: () => T): T | null {
  try {
    return operation();
  } catch {
    return null;
  }
}

function resolveCommit(
  repository: Awaited<ReturnType<typeof openRepository>>,
  spec: string,
): string | null {
  return safe(() => repository.getCommit(repository.revparseSingle(`${spec}^{commit}`)).id());
}

function resolveComparisonRef(
  repository: Awaited<ReturnType<typeof openRepository>>,
): string | null {
  const explicitBase =
    process.env.PR_BASE_SHA?.trim() ||
    process.env.GITHUB_BASE_SHA?.trim();
  if (explicitBase) {
    const resolved = resolveCommit(repository, explicitBase);
    if (resolved) {
      return resolved;
    }
  }

  const baseBranch = process.env.GITHUB_BASE_REF?.trim();
  if (baseBranch) {
    const target = resolveCommit(repository, `origin/${baseBranch}`);
    const head = resolveCommit(repository, "HEAD");
    if (target && head) {
      const mergeBase = safe(() => repository.getMergeBase(head, target));
      if (mergeBase) {
        return mergeBase;
      }
    }
  }

  return resolveCommit(repository, "HEAD~1");
}

function isWithinBacklog(pathValue: string, backlogRoot: string): boolean {
  return pathValue === backlogRoot || pathValue.startsWith(`${backlogRoot}/`);
}

async function trace<T>(
  options: ReadFrontmatterGitSnapshotOptions,
  stage: FrontmatterGitSnapshotTraceStage,
  operation: () => Promise<T>,
): Promise<T> {
  return options.trace ? options.trace.trace(stage, operation) : operation();
}

function recordOutcome(
  options: ReadFrontmatterGitSnapshotOptions,
  stage: FrontmatterGitSnapshotTraceStage,
  value: unknown,
): void {
  options.trace?.recordOutcome(stage, value === null ? "unavailable" : "value");
}

/**
 * Builds all immutable Git facts without running Git subprocesses.
 *
 * The changed path set is intentionally based on libgit2's
 * `diffTreeToWorkdirWithIndex`, which emulates `git diff <tree>` and therefore
 * blends committed, staged, and unstaged tracked changes while excluding
 * untracked files.
 */
export async function readFrontmatterGitSnapshot(
  options: ReadFrontmatterGitSnapshotOptions,
): Promise<FrontmatterGitSnapshot> {
  let repository: Awaited<ReturnType<typeof openRepository>> | null = null;
  const comparisonRef = await trace(options, "comparisonRefResolution", async () => {
    try {
      repository = await openRepository(options.rootDir);
    } catch {
      recordOutcome(options, "comparisonRefResolution", null);
      return null;
    }
    const resolved = resolveComparisonRef(repository);
    recordOutcome(options, "comparisonRefResolution", resolved);
    return resolved;
  });

  let changedPaths: readonly string[] = [];
  if (repository && comparisonRef && options.backlogRoot) {
    const changed = await trace(options, "changedSetRead", async () => safe(() => {
      const baselineTree = repository!.getCommit(comparisonRef).tree();
      const diff = repository!.diffTreeToWorkdirWithIndex(baselineTree);
      diff.findSimilar({ renames: true, copies: false });
      return [...diff.deltas()]
        .map((delta) => delta.newFile().path() ?? delta.oldFile().path())
        .filter((pathValue): pathValue is string =>
          !!pathValue && isWithinBacklog(pathValue, options.backlogRoot!),
        )
        .sort();
    }));
    recordOutcome(options, "changedSetRead", changed);
    if (changed) {
      changedPaths = changed;
    }
  }

  const historicalContents: Record<string, string | null> = {};
  const candidates = [...new Set(options.candidatePaths)];
  for (const candidatePath of candidates) {
    const content = await trace(options, "historicalContentRead", async () => {
      if (!repository || !comparisonRef || !options.backlogRoot) {
        return null;
      }
      return safe(() => {
        const entry = repository!.getCommit(comparisonRef).tree().getPath(candidatePath);
        if (!entry) {
          return null;
        }
        return new TextDecoder().decode(entry.toObject(repository!).peelToBlob().content());
      });
    });
    historicalContents[candidatePath] = content;
    recordOutcome(options, "historicalContentRead", content);
  }

  return Object.freeze({
    comparisonRef,
    changedPaths: Object.freeze([...changedPaths]),
    historicalContents: Object.freeze(historicalContents),
  });
}
