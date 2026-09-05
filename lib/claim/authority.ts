import path from "node:path";
import { canonicalizeClaimScopeRef } from "../runtime/scope-locks.js";
import {
  createRuntimeClaimCommandApi,
  releaseRuntimeClaimAuthority,
  resolveRuntimeClaimAuthority,
  RuntimeClaimSqliteDataAdapter,
  type RuntimeClaimAuthorityLocation,
} from "../runtime-claim/index.js";
import {
  openRuntimeSqliteStore,
  type RuntimeClaimRecord,
  type RuntimeExecutionLogRecord,
  type RuntimeScopeLockRecord,
  type RuntimeLockRecord,
  type RuntimeClaimAcquisitionSeed,
  type RuntimeClaimAuditTrace,
  type RuntimeExecutionHaltOptions,
} from "../runtime/index.js";
import {
  esGitClaimedPathGitAuditAdapter,
  type ClaimedPathGitAuditAdapter,
} from "../runtime/git-audit-adapter.js";

export type ClaimAuthorityLocation = RuntimeClaimAuthorityLocation;

export interface ClaimAuthorityTaskSnapshot {
  claim: RuntimeClaimRecord;
  scopeLocks: RuntimeScopeLockRecord[];
}

export interface ClaimAuthorityTaskExecutionSummary {
  entry: RuntimeExecutionLogRecord;
  claim?: RuntimeClaimRecord;
  locks: RuntimeLockRecord[];
}

/** Result of one public Claim-pack lookup without exposing authority opening. */
export type ClaimAuthorityClaimLookup =
  | { authority: "available"; claim?: RuntimeClaimRecord }
  | { authority: "unavailable" };

/** Result of a Claim-pack list query. */
export type ClaimAuthorityClaimsLookup =
  | { authority: "available"; claims: RuntimeClaimRecord[] }
  | { authority: "unavailable" };

/** Result of an exact-token Claim-pack release. */
export type ClaimAuthorityClaimRelease =
  | { outcome: "released"; claim: RuntimeClaimRecord }
  | { outcome: "missing" }
  | { outcome: "unavailable" };

/** Result of an expired-Claim lease adoption through runtime authority. */
export type ClaimAuthorityClaimAdoption =
  | { outcome: "adopted"; claim: RuntimeClaimRecord }
  | { outcome: "not-expired"; claim: RuntimeClaimRecord }
  | { outcome: "missing" }
  | { outcome: "unavailable" };

/** Result of an atomic release restricted to the inspected expired lease. */
export type ClaimAuthorityExpiredClaimRelease =
  | { outcome: "released"; claim: RuntimeClaimRecord }
  | { outcome: "condition-not-met"; claim: RuntimeClaimRecord }
  | { outcome: "missing" }
  | { outcome: "unavailable" };

export class ClaimAuthorityUnavailableError extends Error {
  readonly code = "CLAIM_AUTHORITY_UNAVAILABLE";

  constructor(rootDir: string) {
    super(`Runtime claim authority is unavailable for repository '${rootDir}'.`);
    this.name = "ClaimAuthorityUnavailableError";
  }
}

/** @deprecated Use the Runtime Claim package authority resolver. */
export const resolveClaimAuthority = resolveRuntimeClaimAuthority;

function withExistingAuthority<T>(
  rootDir: string | undefined,
  callback: (store: ReturnType<typeof openRuntimeSqliteStore>) => T,
  auditTrace?: RuntimeClaimAuditTrace,
): T | undefined {
  const adapter = new RuntimeClaimSqliteDataAdapter({ rootDir, auditTrace });
  return adapter.withExistingStore(callback);
}

async function withExistingAuthorityAsync<T>(
  rootDir: string | undefined,
  callback: (store: ReturnType<typeof openRuntimeSqliteStore>) => Promise<T>,
  auditTrace?: RuntimeClaimAuditTrace,
): Promise<T | undefined> {
  const adapter = new RuntimeClaimSqliteDataAdapter({ rootDir, auditTrace });
  if (!adapter.exists()) {
    return undefined;
  }
  const store = adapter.open();
  try {
    return await callback(store);
  } finally {
    store.close();
  }
}

/**
 * Return the repository-level Claim authority, creating its local runtime store
 * on first consumer access. Claim consumers must not own bootstrap behavior.
 */
export function assertClaimAuthorityAvailable(options: {
  rootDir?: string;
} = {}): ClaimAuthorityLocation {
  return initializeClaimAuthority(options);
}

/**
 * Initialize the shared Claim authority for this repository if it does not yet
 * exist.
 *
 * This keeps operations non-destructive for valid states while preserving existing
 * data if the authority is already present.
 */
export function initializeClaimAuthority(options: {
  rootDir?: string;
} = {}): ClaimAuthorityLocation {
  const adapter = new RuntimeClaimSqliteDataAdapter({ rootDir: options.rootDir });
  const store = adapter.open();
  try {
    return adapter.location;
  } finally {
    store.close();
  }
}

/**
 * Require the shared repository authority rather than accepting a worktree-local
 * database or an absent authority as a Work fallback.
 */
export function assertNoWorktreeClaimAuthorityFallback(options: {
  rootDir?: string;
} = {}): ClaimAuthorityLocation {
  return assertClaimAuthorityAvailable(options);
}

export function loadClaimAuthorityTaskExecutionLogSummaries(options: {
  rootDir?: string;
  taskIds?: Iterable<string>;
} = {}): Map<string, RuntimeExecutionLogRecord> {
  return (
    withExistingAuthority(options.rootDir, (store) =>
      loadClaimAuthorityTaskExecutionLogSummariesFromStore(store, options.taskIds),
    ) ?? new Map()
  );
}

export function loadClaimAuthorityTaskExecutionSummaries(options: {
  rootDir?: string;
  taskIds?: Iterable<string>;
} = {}): Map<string, ClaimAuthorityTaskExecutionSummary> {
  return (
    withExistingAuthority(options.rootDir, (store) => {
      const entries = loadClaimAuthorityTaskExecutionLogSummariesFromStore(
        store,
        options.taskIds,
      );
      return new Map(
        [...entries.entries()].map(([taskId, entry]) => [
          taskId,
          {
            entry,
            claim: store.getClaimByToken(entry.claim_token),
            locks: store.listLocksByClaimToken(entry.claim_token),
          },
        ]),
      );
    }) ?? new Map()
  );
}

function loadClaimAuthorityTaskExecutionLogSummariesFromStore(
  store: ReturnType<typeof openRuntimeSqliteStore>,
  taskIds: Iterable<string> | undefined,
): Map<string, RuntimeExecutionLogRecord> {
  const taskIdSet = taskIds ? new Set(taskIds) : undefined;
  const summaries = new Map<string, RuntimeExecutionLogRecord>();
  for (const entry of store.listExecutionLogEntries()) {
    if (
      entry.target_type !== "task" ||
      (taskIdSet && !taskIdSet.has(entry.target_id))
    ) {
      continue;
    }
    const current = summaries.get(entry.target_id);
    if (
      !current ||
      entry.created_at > current.created_at ||
      (entry.created_at === current.created_at && entry.id > current.id)
    ) {
      summaries.set(entry.target_id, entry);
    }
  }
  return summaries;
}

export function loadClaimAuthorityTaskSnapshots(options: {
  rootDir?: string;
  taskIds: Iterable<string>;
}): Map<string, ClaimAuthorityTaskSnapshot> {
  return (
    withExistingAuthority(options.rootDir, (store) => {
      const snapshots = new Map<string, ClaimAuthorityTaskSnapshot>();
      for (const taskId of new Set(options.taskIds)) {
        const claim = store.getClaimByTarget("task", taskId);
        if (!claim) {
          continue;
        }
        snapshots.set(taskId, {
          claim,
          scopeLocks: store.listScopeLocksByClaimToken(claim.claim_token),
        });
      }
      return snapshots;
    }) ?? new Map()
  );
}

/**
 * Look up one Claim through the Claim-pack boundary, preserving whether the
 * repository authority itself was available.
 */
export function lookupClaimAuthorityClaimByToken(options: {
  rootDir?: string;
  claimToken: string;
}): ClaimAuthorityClaimLookup {
  const result = withExistingAuthority(options.rootDir, (store) => ({
    authority: "available" as const,
    claim: store.getClaimByToken(options.claimToken),
  }));
  return result ?? { authority: "unavailable" };
}

export function loadClaimAuthorityClaimByToken(options: {
  rootDir?: string;
  claimToken: string;
}): RuntimeClaimRecord | undefined {
  const lookup = lookupClaimAuthorityClaimByToken(options);
  return lookup.authority === "available" ? lookup.claim : undefined;
}

/** List Claims through the Claim-pack boundary without opening authority for callers. */
export function listClaimAuthorityClaims(options: {
  rootDir?: string;
} = {}): ClaimAuthorityClaimsLookup {
  const result = withExistingAuthority(options.rootDir, (store) => ({
    authority: "available" as const,
    claims: store.listClaims(),
  }));
  return result ?? { authority: "unavailable" };
}

/** Look up one Claim target through the Claim-pack boundary. */
export function lookupClaimAuthorityClaimByTarget(options: {
  rootDir?: string;
  targetType: string;
  targetId: string;
}): ClaimAuthorityClaimLookup {
  const result = withExistingAuthority(options.rootDir, (store) => ({
    authority: "available" as const,
    claim: store.getClaimByTarget(options.targetType, options.targetId),
  }));
  return result ?? { authority: "unavailable" };
}

/** Release exactly the Claim record selected by its token. */
export function releaseClaimAuthorityClaimByToken(options: {
  rootDir?: string;
  claimToken: string;
}): ClaimAuthorityClaimRelease {
  const adapter = new RuntimeClaimSqliteDataAdapter({ rootDir: options.rootDir });
  if (!adapter.exists()) {
    return { outcome: "unavailable" };
  }
  return createRuntimeClaimCommandApi({ rootDir: options.rootDir })
    .releaseClaim(options.claimToken);
}

/**
 * Release only if the authoritative Claim remains the expired lease inspected
 * by the caller. The expiry fingerprint makes adoption/release races fail
 * closed inside one SQLite transaction.
 */
export function releaseExpiredClaimAuthorityClaimByToken(options: {
  rootDir?: string;
  claimToken: string;
  expectedExpiresAt: string;
}): ClaimAuthorityExpiredClaimRelease {
  const result = withExistingAuthority(options.rootDir, (store) => {
    const release = store.releaseExpiredRuntimeClaim(
      options.claimToken,
      options.expectedExpiresAt,
    );
    if (release.outcome === "released") {
      return { outcome: "released" as const, claim: release.claim };
    }
    if (release.outcome === "condition-not-met") {
      return { outcome: "condition-not-met" as const, claim: release.claim };
    }
    return { outcome: "missing" as const };
  });
  return result ?? { outcome: "unavailable" };
}

/** Reopen an expired Claim lease after the caller has completed lineage review. */
export function adoptExpiredClaimAuthorityClaimByToken(options: {
  rootDir?: string;
  claimToken: string;
  ttlMilliseconds?: number;
}): ClaimAuthorityClaimAdoption {
  const result = withExistingAuthority(options.rootDir, (store) => {
    const claim = store.getClaimByToken(options.claimToken);
    if (!claim) {
      return { outcome: "missing" as const };
    }
    if (claim.state !== "expired") {
      return { outcome: "not-expired" as const, claim };
    }
    return {
      outcome: "adopted" as const,
      claim: store.touchClaimContext(options.claimToken, {
        renew: true,
        ttlMilliseconds: options.ttlMilliseconds,
      }),
    };
  });
  return result ?? { outcome: "unavailable" };
}

export function releaseClaimAuthorityTaskClaim(options: {
  rootDir?: string;
  taskId: string;
}): void {
  const adapter = new RuntimeClaimSqliteDataAdapter({ rootDir: options.rootDir });
  const claim = adapter.getClaimByTarget("task", options.taskId);
  if (claim) {
    releaseRuntimeClaimAuthority({
      rootDir: options.rootDir,
      claimToken: claim.claim_token,
    });
  }
}

export function acquireClaimAuthorityRuntimeClaim(options: {
  rootDir?: string;
  seed: RuntimeClaimAcquisitionSeed;
  initialLockPaths: string[];
}) {
  return createRuntimeClaimCommandApi({ rootDir: options.rootDir }).acquireClaim(
    options.seed,
    options.initialLockPaths,
  );
}

export function haltClaimAuthorityExecution(options: {
  rootDir?: string;
  claimToken: string;
  halt: RuntimeExecutionHaltOptions;
}) {
  return readClaimAuthority({
    rootDir: options.rootDir,
    callback: (store) => store.haltRuntimeExecution(options.claimToken, options.halt),
  });
}

export function loadClaimAuthorityLatestHaltedTaskExecution(options: {
  rootDir?: string;
  taskId: string;
}): RuntimeExecutionLogRecord | undefined {
  return withExistingAuthority(options.rootDir, (store) =>
    [...store.listExecutionLogEntries()]
      .reverse()
      .find(
        (entry) => entry.target_id === options.taskId && entry.state === "halted",
      ),
  );
}

export function loadClaimAuthorityClaimByTarget(options: {
  rootDir?: string;
  targetType: string;
  targetId: string;
}): RuntimeClaimRecord | undefined {
  return withExistingAuthority(options.rootDir, (store) =>
    store.getClaimByTarget(options.targetType, options.targetId),
  );
}

export async function auditClaimAuthorityChangedFiles(options: {
  rootDir?: string;
  claimToken: string;
  mergeTargetRef?: string;
}) {
  return withExistingAuthorityAsync(
    options.rootDir,
    (store) => store.auditChangedFiles(
      options.claimToken,
      options.mergeTargetRef ? { mergeTargetRef: options.mergeTargetRef } : {},
    ),
  );
}

export async function auditClaimAuthorityClaimedPaths(options: {
  rootDir?: string;
  claimToken: string;
  requiredPaths: string[];
  mergeTargetRef?: string;
  auditTrace?: RuntimeClaimAuditTrace;
  gitAuditAdapter?: ClaimedPathGitAuditAdapter;
}) {
  const result = await withExistingAuthorityAsync(
    options.rootDir,
    (store) =>
      store.auditClaimedPathsWithGitAdapter(
        options.claimToken,
        options.requiredPaths,
        options.gitAuditAdapter ?? esGitClaimedPathGitAuditAdapter,
        {
          ...(options.mergeTargetRef
            ? { mergeTargetRef: options.mergeTargetRef }
            : {}),
          gitRootDir: path.resolve(options.rootDir ?? process.cwd()),
        },
      ),
    options.auditTrace,
  );
  if (result === undefined) {
    const authority = resolveClaimAuthority(options.rootDir);
    throw new ClaimAuthorityUnavailableError(authority.rootDir);
  }
  return result;
}

export function loadClaimAuthoritySubjects(options: {
  rootDir?: string;
  claimToken: string;
}): string[] {
  return (
    withExistingAuthority(options.rootDir, (store) => {
      const claim = store.getClaimByToken(options.claimToken);
      if (!claim) {
        return [];
      }
      const subjects = new Set<string>([
        `claim:${claim.claim_token}`,
        canonicalizeClaimScopeRef(claim.target_type, claim.target_id),
      ]);
      for (const scopeLock of store.listScopeLocksByClaimToken(
        options.claimToken,
      )) {
        if (scopeLock.lifecycle_state === "active") {
          subjects.add(scopeLock.scope_ref);
        }
      }
      return [...subjects];
    }) ?? []
  );
}

export function completeClaimAuthorityExecution(options: {
  rootDir?: string;
  claimToken: string;
}) {
  return readClaimAuthority({
    rootDir: options.rootDir,
    callback: (store) => store.completeRuntimeExecution(options.claimToken),
  });
}

export function readClaimAuthority<T>(options: {
  rootDir?: string;
  auditTrace?: RuntimeClaimAuditTrace;
  callback: (store: ReturnType<typeof openRuntimeSqliteStore>) => T;
}): T {
  const result = withExistingAuthority(
    options.rootDir,
    options.callback,
    options.auditTrace,
  );
  if (result === undefined) {
    const authority = resolveClaimAuthority(options.rootDir);
    throw new ClaimAuthorityUnavailableError(authority.rootDir);
  }
  return result;
}
