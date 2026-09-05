import { execFileSync } from "node:child_process";
import { openRepository } from "es-git";

/** Repository metadata used only by claimed-path lock audits. */
export interface ClaimedPathGitMetadata {
  branch?: string;
  detached: boolean;
  headOid?: string;
}

/**
 * The narrow Git seam for claimed-path lock audits. Other Git callers remain
 * independent of this adapter while rollout continues.
 */
export interface ClaimedPathGitAuditAdapter {
  readMetadata(rootDir: string): Promise<ClaimedPathGitMetadata>;
}

export class ClaimedPathGitMetadataReadError extends Error {
  readonly adapter: "cli" | "es-git";
  readonly rootDir: string;

  constructor(options: {
    adapter: "cli" | "es-git";
    rootDir: string;
    cause: unknown;
  }) {
    const detail =
      options.cause instanceof Error ? options.cause.message : String(options.cause);
    super(
      `Unable to read claimed-path Git metadata with ${options.adapter} at '${options.rootDir}': ${detail}`,
    );
    this.name = "ClaimedPathGitMetadataReadError";
    this.adapter = options.adapter;
    this.rootDir = options.rootDir;
  }
}

function gitOutput(rootDir: string, args: string[]): string | undefined {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim() || undefined;
}

/** Injectable fallback adapter preserving the audit's existing Git CLI reads. */
export const cliClaimedPathGitAuditAdapter: ClaimedPathGitAuditAdapter = {
  async readMetadata(rootDir) {
    try {
      const branch = gitOutput(rootDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
      const headOid = gitOutput(rootDir, ["rev-parse", "HEAD"]);
      const detached = branch === "HEAD";
      return {
        ...(branch && !detached ? { branch } : {}),
        detached,
        ...(headOid ? { headOid } : {}),
      };
    } catch (cause) {
      throw new ClaimedPathGitMetadataReadError({
        adapter: "cli",
        rootDir,
        cause,
      });
    }
  },
};

/** Canonical production adapter for claimed-path Git audits. */
export const esGitClaimedPathGitAuditAdapter: ClaimedPathGitAuditAdapter = {
  async readMetadata(rootDir) {
    try {
      const repository = await openRepository(rootDir);
      const head = repository.head();
      const headOid = head.target() ?? head.resolve().target() ?? undefined;
      if (repository.headDetached()) {
        return {
          detached: true,
          ...(headOid ? { headOid } : {}),
        };
      }
      return {
        branch: head.shorthand(),
        detached: false,
        ...(headOid ? { headOid } : {}),
      };
    } catch (cause) {
      throw new ClaimedPathGitMetadataReadError({
        adapter: "es-git",
        rootDir,
        cause,
      });
    }
  },
};
