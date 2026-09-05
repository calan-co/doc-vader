import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { openRepository } from "es-git";
import {
  lookupClaimAuthorityClaimByToken,
  resolveClaimAuthority,
} from "./authority.js";

export type ExpiredTaskLineageClassification =
  | "release_safe"
  | "adopt_recommended"
  | "manual_review_required";

export type ExpiredTaskLineageManualReason =
  | "claim_authority_unavailable"
  | "claim_missing"
  | "claim_not_task"
  | "claim_not_expired"
  | "execution_metadata_missing"
  | "worktree_missing"
  | "branch_missing"
  | "base_missing"
  | "worktree_not_git"
  | "worktree_not_registered"
  | "worktree_authority_mismatch"
  | "detached"
  | "branch_unavailable"
  | "base_unavailable"
  | "git_error";

export interface ExpiredTaskLineageGitContext {
  /** The sole local Git cwd for this inspection, from Claim execution metadata. */
  readonly worktreePath: string;
  /** The Claim authority repository that must own the selected worktree. */
  readonly authorityRoot: string;
  readonly branch: string;
  readonly baseRef: string;
}

export type ExpiredTaskLineageGitInspection =
  | { readonly state: "attached"; readonly aheadCount: number }
  | { readonly state: "detached" }
  | {
      readonly state: "unavailable";
      readonly reason: Extract<
        ExpiredTaskLineageManualReason,
        | "worktree_missing"
        | "worktree_not_git"
        | "worktree_not_registered"
        | "worktree_authority_mismatch"
        | "branch_unavailable"
        | "base_unavailable"
        | "git_error"
      >;
      readonly message?: string;
    };

/** The narrow read-only Git seam for expired task Claim lineage. */
export interface ExpiredTaskLineageGitAdapter {
  inspect(context: ExpiredTaskLineageGitContext): Promise<ExpiredTaskLineageGitInspection>;
}

export interface ExpiredTaskLineageTrace {
  record(stage: "claim-read" | "git-inspection", outcome: string): void;
}

export type ExpiredTaskClaimLineageInspection =
  | {
      readonly outcome: "authoritative";
      readonly classification: "release_safe" | "adopt_recommended";
      readonly claimToken: string;
      readonly taskId: string;
      /** Expiry fingerprint required for a conditional recovery release. */
      readonly claimExpiresAt: string;
      readonly git: ExpiredTaskLineageGitContext & { readonly aheadCount: number };
      /** One Git use-case inspection was performed. */
      readonly gitInspectionCount: 1;
    }
  | {
      readonly outcome: "manual_review_required";
      readonly classification: "manual_review_required";
      readonly claimToken: string;
      readonly reason: ExpiredTaskLineageManualReason;
      readonly message?: string;
      readonly gitInspectionCount: number;
    };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cliOutput(gitExecutable: string, cwd: string, args: readonly string[]): string {
  return execFileSync(gitExecutable, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function canonicalPath(value: string): string {
  const resolved = path.resolve(value);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function parseCliWorktreePaths(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => canonicalPath(line.slice("worktree ".length)));
}

function gitCommonDirectoryRoot(worktreePath: string, gitCommonDir: string): string {
  const commonDirectory = path.resolve(worktreePath, gitCommonDir);
  return canonicalPath(path.dirname(commonDirectory));
}

function unavailable(
  reason: Extract<ExpiredTaskLineageGitInspection, { state: "unavailable" }> ["reason"],
  error?: unknown,
): ExpiredTaskLineageGitInspection {
  return {
    state: "unavailable",
    reason,
    ...(error === undefined ? {} : { message: errorMessage(error) }),
  };
}

/**
 * The production adapter uses only this use-case's fixed read commands. Every
 * command is executed in the metadata-selected worktree; there is no generic
 * command execution surface and no authority-root Git fallback.
 */
export function createCliExpiredTaskLineageGitAdapter(options: {
  readonly gitExecutable?: string;
} = {}): ExpiredTaskLineageGitAdapter {
  const gitExecutable = options.gitExecutable ?? "git";
  return {
    async inspect(context) {
      const worktreePath = canonicalPath(context.worktreePath);
      if (!existsSync(worktreePath)) {
        return unavailable("worktree_missing");
      }

      let topLevel: string;
      try {
        if (cliOutput(gitExecutable, worktreePath, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
          return unavailable("worktree_not_git");
        }
        topLevel = path.resolve(
          cliOutput(gitExecutable, worktreePath, ["rev-parse", "--show-toplevel"]),
        );
      } catch (error) {
        return unavailable("worktree_not_git", error);
      }

      if (canonicalPath(topLevel) !== worktreePath) {
        return unavailable("worktree_not_registered");
      }

      let authorityRoot: string;
      try {
        authorityRoot = gitCommonDirectoryRoot(
          worktreePath,
          cliOutput(gitExecutable, worktreePath, ["rev-parse", "--git-common-dir"]),
        );
      } catch (error) {
        return unavailable("git_error", error);
      }
      if (authorityRoot !== canonicalPath(context.authorityRoot)) {
        return unavailable(
          "worktree_authority_mismatch",
          `Selected worktree belongs to '${authorityRoot}', not Claim authority '${canonicalPath(context.authorityRoot)}'.`,
        );
      }

      let registeredWorktrees: string[];
      try {
        registeredWorktrees = parseCliWorktreePaths(
          cliOutput(gitExecutable, worktreePath, ["worktree", "list", "--porcelain"]),
        );
      } catch (error) {
        return unavailable("git_error", error);
      }
      if (!registeredWorktrees.includes(worktreePath)) {
        return unavailable("worktree_not_registered");
      }

      let branch: string;
      try {
        branch = cliOutput(gitExecutable, worktreePath, ["branch", "--show-current"]);
      } catch (error) {
        return unavailable("branch_unavailable", error);
      }
      if (!branch) {
        return { state: "detached" };
      }
      if (branch !== context.branch) {
        return unavailable(
          "branch_unavailable",
          `Claim branch '${context.branch}' does not match checked-out branch '${branch}'.`,
        );
      }

      let baseOid: string;
      let headOid: string;
      try {
        baseOid = cliOutput(gitExecutable, worktreePath, [
          "rev-parse", "--verify", "--quiet", "--end-of-options", `${context.baseRef}^{commit}`,
        ]);
        headOid = cliOutput(gitExecutable, worktreePath, ["rev-parse", "HEAD"]);
      } catch (error) {
        return unavailable("base_unavailable", error);
      }
      if (!baseOid || !headOid) {
        return unavailable("base_unavailable");
      }

      try {
        const output = cliOutput(gitExecutable, worktreePath, [
          "rev-list", "--count", `${baseOid}..${headOid}`,
        ]);
        const aheadCount = Number.parseInt(output, 10);
        if (!Number.isSafeInteger(aheadCount) || aheadCount < 0) {
          return unavailable("git_error", "Git returned an invalid ahead count.");
        }
        return { state: "attached", aheadCount };
      } catch (error) {
        return unavailable("git_error", error);
      }
    },
  };
}

/** Optional LibGit2 implementation of the same fixed expired-lineage facts. */
export const esGitExpiredTaskLineageGitAdapter: ExpiredTaskLineageGitAdapter = {
  async inspect(context) {
    const worktreePath = canonicalPath(context.worktreePath);
    if (!existsSync(worktreePath)) {
      return unavailable("worktree_missing");
    }

    let repository: Awaited<ReturnType<typeof openRepository>>;
    try {
      repository = await openRepository(worktreePath);
    } catch (error) {
      return unavailable("worktree_not_git", error);
    }
    const topLevel = canonicalPath(repository.workdir() ?? worktreePath);
    if (topLevel !== worktreePath) {
      return unavailable("worktree_not_registered");
    }

    /*
     * A linked repository can only be opened when Git has a registered
     * worktree administration entry. Derive its common-worktree root from the
     * selected repository's own gitdir; do not open or enumerate the Claim
     * authority worktree to validate a metadata-selected worktree.
     */
    const gitDirectory = canonicalPath(repository.path());
    const authorityRoot = repository.isWorktree()
      ? canonicalPath(path.resolve(gitDirectory, "..", "..", ".."))
      : canonicalPath(path.dirname(gitDirectory));
    if (authorityRoot !== canonicalPath(context.authorityRoot)) {
      return unavailable("worktree_authority_mismatch");
    }

    if (repository.headDetached()) {
      return { state: "detached" };
    }
    const branch = repository.head().shorthand();
    if (!branch || branch !== context.branch) {
      return unavailable(
        "branch_unavailable",
        branch
          ? `Claim branch '${context.branch}' does not match checked-out branch '${branch}'.`
          : undefined,
      );
    }

    let baseOid: string;
    let headOid: string;
    try {
      baseOid = repository.revparseSingle(context.baseRef);
      headOid = repository.head().target() ?? repository.head().resolve().target() ?? "";
    } catch (error) {
      return unavailable("base_unavailable", error);
    }
    if (!headOid) {
      return unavailable("base_unavailable");
    }
    try {
      const walker = repository.revwalk();
      walker.push(headOid).hide(baseOid);
      let aheadCount = 0;
      while (walker.next()) {
        aheadCount += 1;
      }
      return { state: "attached", aheadCount };
    } catch (error) {
      return unavailable("git_error", error);
    }
  },
};

/** CLI remains injectable for compatibility and focused adapter tests. */
export const cliExpiredTaskLineageGitAdapter = createCliExpiredTaskLineageGitAdapter();

/** LibGit2 is the Claim-pack default; there is no user-facing adapter selector. */
export const defaultExpiredTaskLineageGitAdapter = esGitExpiredTaskLineageGitAdapter;

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function manual(
  claimToken: string,
  reason: ExpiredTaskLineageManualReason,
  gitInspectionCount: number,
  message?: string,
): ExpiredTaskClaimLineageInspection {
  return {
    outcome: "manual_review_required",
    classification: "manual_review_required",
    claimToken,
    reason,
    ...(message ? { message } : {}),
    gitInspectionCount,
  };
}

/**
 * Read-only expired task-lineage query. Claim-pack metadata selects both the
 * Claim authority and the sole Git worktree; task-local JSON has no lineage
 * authority and the caller's cwd is never inspected as Git context.
 */
export async function inspectExpiredTaskClaimLineage(options: {
  readonly rootDir?: string;
  readonly claimToken: string;
  readonly gitAdapter?: ExpiredTaskLineageGitAdapter;
  readonly trace?: ExpiredTaskLineageTrace;
}): Promise<ExpiredTaskClaimLineageInspection> {
  const lookup = lookupClaimAuthorityClaimByToken({
    rootDir: options.rootDir,
    claimToken: options.claimToken,
  });
  if (lookup.authority === "unavailable") {
    options.trace?.record("claim-read", "claim_authority_unavailable");
    return manual(options.claimToken, "claim_authority_unavailable", 0);
  }
  const claim = lookup.claim;
  if (!claim) {
    options.trace?.record("claim-read", "claim_missing");
    return manual(options.claimToken, "claim_missing", 0);
  }
  if (claim.target_type !== "task") {
    options.trace?.record("claim-read", "claim_not_task");
    return manual(options.claimToken, "claim_not_task", 0);
  }
  if (claim.state !== "expired") {
    options.trace?.record("claim-read", "claim_not_expired");
    return manual(options.claimToken, "claim_not_expired", 0);
  }
  if (!claim.metadata) {
    options.trace?.record("claim-read", "execution_metadata_missing");
    return manual(options.claimToken, "execution_metadata_missing", 0);
  }
  const worktree = metadataString(claim.metadata, "worktree");
  if (!worktree) {
    options.trace?.record("claim-read", "worktree_missing");
    return manual(options.claimToken, "worktree_missing", 0);
  }
  const branch = metadataString(claim.metadata, "branch");
  if (!branch) {
    options.trace?.record("claim-read", "branch_missing");
    return manual(options.claimToken, "branch_missing", 0);
  }
  const baseRef = metadataString(claim.metadata, "baseRef");
  if (!baseRef) {
    options.trace?.record("claim-read", "base_missing");
    return manual(options.claimToken, "base_missing", 0);
  }

  const authority = resolveClaimAuthority(options.rootDir);
  const context: ExpiredTaskLineageGitContext = {
    worktreePath: path.resolve(authority.rootDir, worktree),
    authorityRoot: authority.rootDir,
    branch,
    baseRef,
  };
  let result: ExpiredTaskLineageGitInspection;
  try {
    result = await (options.gitAdapter ?? defaultExpiredTaskLineageGitAdapter).inspect(context);
  } catch (error) {
    options.trace?.record("git-inspection", "git_error");
    return manual(options.claimToken, "git_error", 1, errorMessage(error));
  }
  if (result.state === "detached") {
    options.trace?.record("git-inspection", "detached");
    return manual(options.claimToken, "detached", 1);
  }
  options.trace?.record("git-inspection", result.state === "attached" ? "attached" : result.reason);
  if (result.state === "unavailable") {
    return manual(options.claimToken, result.reason, 1, result.message);
  }
  return {
    outcome: "authoritative",
    classification: result.aheadCount === 0 ? "release_safe" : "adopt_recommended",
    claimToken: options.claimToken,
    taskId: claim.target_id,
    claimExpiresAt: claim.expires_at,
    git: { ...context, aheadCount: result.aheadCount },
    gitInspectionCount: 1,
  };
}
