import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { openRepository } from "es-git";

/** The immutable Git facts consumed by the full changed-file lock audit. */
export interface RuntimeChangedFileGitSnapshot {
  readonly headRef?: string;
  readonly headSha?: string;
  readonly mergeTargetSha?: string;
  readonly mergeBaseSha?: string;
  /** CLI-compatible NUL-delimited name-status data. */
  readonly branchDiff?: string;
  /** CLI-compatible NUL-delimited name-status data. */
  readonly worktreeDiff?: string;
  /** CLI-compatible NUL-delimited untracked paths. */
  readonly untracked?: string;
  /** Undefined means the mergeability fact could not be read. */
  readonly mergeTreeOutput?: string;
}

export const RUNTIME_CHANGED_FILE_GIT_SNAPSHOT_STAGES = [
  "gitChangedFilesHeadRef",
  "gitChangedFilesHead",
  "gitChangedFilesMergeTarget",
  "gitChangedFilesMergeBase",
  "gitChangedFilesMergeTree",
  "gitChangedFilesBranchDiff",
  "gitChangedFilesWorktreeDiff",
  "gitChangedFilesUntracked",
] as const;

export type RuntimeChangedFileGitSnapshotStage =
  (typeof RUNTIME_CHANGED_FILE_GIT_SNAPSHOT_STAGES)[number];

/** Optional instrumentation owned by the full-audit caller, not the adapters. */
export interface RuntimeChangedFileGitSnapshotTrace {
  trace<T>(
    stage: RuntimeChangedFileGitSnapshotStage,
    operation: () => Promise<T>,
  ): Promise<T>;
  recordOutcome?(
    stage: RuntimeChangedFileGitSnapshotStage,
    outcome: "value" | "undefined",
  ): void;
  recordDirectGitSubprocess?(durationMs: number): void;
}

export interface RuntimeChangedFileGitSnapshotReader {
  readSnapshot(options: {
    rootDir: string;
    mergeTargetRef: string;
    trace?: RuntimeChangedFileGitSnapshotTrace;
  }): Promise<RuntimeChangedFileGitSnapshot>;
}

async function readOutput(
  options: Parameters<RuntimeChangedFileGitSnapshotReader["readSnapshot"]>[0],
  stage: RuntimeChangedFileGitSnapshotStage,
  operation: () => string | undefined | Promise<string | undefined>,
): Promise<string | undefined> {
  const read = async () => operation();
  const output = options.trace ? await options.trace.trace(stage, read) : await read();
  options.trace?.recordOutcome?.(stage, output === undefined ? "undefined" : "value");
  return output;
}

function cliGitOutput(rootDir: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
  } catch {
    return undefined;
  }
}

/** Canonical production reader. It preserves the full audit's silent CLI failures. */
export const cliRuntimeChangedFileGitSnapshotReader: RuntimeChangedFileGitSnapshotReader = {
  async readSnapshot(options) {
    const output = (stage: RuntimeChangedFileGitSnapshotStage, args: string[]) =>
      readOutput(options, stage, () => {
        const startedAt = performance.now();
        try {
          return cliGitOutput(options.rootDir, args);
        } finally {
          options.trace?.recordDirectGitSubprocess?.(performance.now() - startedAt);
        }
      });
    const headRef = await output("gitChangedFilesHeadRef", [
      "rev-parse", "--abbrev-ref", "HEAD",
    ]);
    const headSha = await output("gitChangedFilesHead", ["rev-parse", "HEAD"]);
    const mergeTargetSha = await output("gitChangedFilesMergeTarget", [
      "rev-parse", options.mergeTargetRef,
    ]);
    const mergeBaseSha = mergeTargetSha && headSha
      ? await output("gitChangedFilesMergeBase", [
          "merge-base", options.mergeTargetRef, "HEAD",
        ])
      : undefined;
    const mergeTreeOutput = mergeTargetSha && headSha
      ? await output("gitChangedFilesMergeTree", [
          "merge-tree", mergeBaseSha?.trim() || options.mergeTargetRef,
          options.mergeTargetRef, "HEAD",
        ])
      : undefined;
    const branchDiff = await output("gitChangedFilesBranchDiff", [
      "diff", "--name-status", "-z", "--find-renames",
      `${options.mergeTargetRef}...HEAD`,
    ]);
    const worktreeDiff = await output("gitChangedFilesWorktreeDiff", [
      "diff", "--name-status", "-z", "--find-renames", "HEAD",
    ]);
    const untracked = await output("gitChangedFilesUntracked", [
      "ls-files", "--others", "--exclude-standard", "-z",
    ]);
    return Object.freeze({
      ...(headRef === undefined ? {} : { headRef }),
      ...(headSha === undefined ? {} : { headSha }),
      ...(mergeTargetSha === undefined ? {} : { mergeTargetSha }),
      ...(mergeBaseSha === undefined ? {} : { mergeBaseSha }),
      ...(mergeTreeOutput === undefined ? {} : { mergeTreeOutput }),
      ...(branchDiff === undefined ? {} : { branchDiff }),
      ...(worktreeDiff === undefined ? {} : { worktreeDiff }),
      ...(untracked === undefined ? {} : { untracked }),
    });
  },
};

function deltaStatus(status: string): string | undefined {
  return ({
    Added: "A",
    Deleted: "D",
    Modified: "M",
    Renamed: "R",
    Copied: "C",
    Typechange: "T",
    Untracked: "??",
  } as Record<string, string | undefined>)[status];
}

function serializeDiff(diff: ReturnType<Awaited<ReturnType<typeof openRepository>>["diffTreeToTree"]>): string {
  // Match CLI --find-renames: detect renames, but do not discover copies.
  diff.findSimilar({ renames: true, copies: false });
  const entries: string[] = [];
  for (const delta of diff.deltas()) {
    const status = deltaStatus(delta.status());
    const previousPath = delta.oldFile().path();
    const pathValue = delta.newFile().path() ?? previousPath;
    if (!status || !pathValue) {
      continue;
    }
    if ((status === "R" || status === "C") && previousPath) {
      entries.push(`${status}100`, previousPath, pathValue);
    } else {
      entries.push(status, pathValue);
    }
  }
  return entries.length > 0 ? `${entries.join("\0")}\0` : "";
}

function resolveHeadSha(repository: Awaited<ReturnType<typeof openRepository>>): string | undefined {
  const head = repository.head();
  return head.target() ?? head.resolve().target() ?? undefined;
}

async function readUnavailableEsGitSnapshot(
  options: Parameters<RuntimeChangedFileGitSnapshotReader["readSnapshot"]>[0],
): Promise<RuntimeChangedFileGitSnapshot> {
  // Mirror CLI's swallowed reads: dependent merge-base/tree reads are not attempted.
  for (const stage of [
    "gitChangedFilesHeadRef",
    "gitChangedFilesHead",
    "gitChangedFilesMergeTarget",
    "gitChangedFilesBranchDiff",
    "gitChangedFilesWorktreeDiff",
    "gitChangedFilesUntracked",
  ] satisfies RuntimeChangedFileGitSnapshotStage[]) {
    await readOutput(options, stage, () => undefined);
  }
  return Object.freeze({});
}

/** Canonical LibGit2/es-git implementation for full changed-file audits. */
export const esGitRuntimeChangedFileGitSnapshotReader: RuntimeChangedFileGitSnapshotReader = {
  async readSnapshot(options) {
    let repository: Awaited<ReturnType<typeof openRepository>>;
    try {
      repository = await openRepository(options.rootDir);
    } catch {
      return readUnavailableEsGitSnapshot(options);
    }
    const safely = <T>(operation: () => T): T | undefined => {
      try {
        return operation();
      } catch {
        return undefined;
      }
    };
    const output = (
      stage: RuntimeChangedFileGitSnapshotStage,
      operation: () => string | undefined,
    ) => readOutput(options, stage, () => safely(operation));
    const headRef = await output("gitChangedFilesHeadRef", () =>
      repository.headDetached() ? "HEAD" : repository.head().shorthand(),
    );
    const headSha = await output("gitChangedFilesHead", () => resolveHeadSha(repository));
    const mergeTargetSha = await output("gitChangedFilesMergeTarget", () =>
      repository.revparseSingle(options.mergeTargetRef),
    );
    const mergeBaseSha = mergeTargetSha && headSha
      ? await output("gitChangedFilesMergeBase", () =>
          repository.getMergeBase(mergeTargetSha, headSha),
        )
      : undefined;
    const mergeTreeOutput = mergeTargetSha && headSha
      ? await output("gitChangedFilesMergeTree", () => {
          const base = repository.getCommit(mergeBaseSha ?? mergeTargetSha);
          const target = repository.getCommit(mergeTargetSha);
          const head = repository.getCommit(headSha);
          return repository.mergeTrees(base.tree(), target.tree(), head.tree()).hasConflicts()
            ? "<<<<<<<"
            : "";
        })
      : undefined;
    const branchDiff = await output("gitChangedFilesBranchDiff", () => {
      const base = repository.getCommit(
        repository.getMergeBase(
          repository.revparseSingle(options.mergeTargetRef),
          resolveHeadSha(repository)!,
        ),
      );
      const head = repository.getCommit(resolveHeadSha(repository)!);
      return serializeDiff(repository.diffTreeToTree(base.tree(), head.tree()));
    });
    const worktreeDiff = await output("gitChangedFilesWorktreeDiff", () => {
      const headSha = resolveHeadSha(repository);
      return headSha
        ? serializeDiff(repository.diffTreeToWorkdirWithIndex(repository.getCommit(headSha).tree()))
        : undefined;
    });
    const untracked = await output("gitChangedFilesUntracked", () => {
      const paths = [...repository.statuses().iter()]
        .filter((entry) => {
          const status = entry.status();
          return status.wtNew && !status.indexNew && !status.ignored;
        })
        .map((entry) => entry.path());
      return paths.length > 0 ? `${paths.join("\0")}\0` : "";
    });
    return Object.freeze({
      ...(headRef === undefined ? {} : { headRef }),
      ...(headSha === undefined ? {} : { headSha }),
      ...(mergeTargetSha === undefined ? {} : { mergeTargetSha }),
      ...(mergeBaseSha === undefined ? {} : { mergeBaseSha }),
      ...(mergeTreeOutput === undefined ? {} : { mergeTreeOutput }),
      ...(branchDiff === undefined ? {} : { branchDiff }),
      ...(worktreeDiff === undefined ? {} : { worktreeDiff }),
      ...(untracked === undefined ? {} : { untracked }),
    });
  },
};
