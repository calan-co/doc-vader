import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { TaskCommandError } from "../task/errors.js";
import {
  normalizeRuntimeLockPath,
  openRuntimeSqliteStore,
  type RuntimeChangedFileAuditResult,
  type RuntimeClaimAcquisitionSeed,
  type RuntimeClaimAuditTrace,
  type RuntimeClaimCleanupResult,
  type RuntimeClaimCoverageAuditTrace,
  type RuntimeClaimRecord as SqliteRuntimeClaimRecord,
  type RuntimeClaimRenewalResult as SqliteRuntimeClaimRenewalResult,
  type RuntimeExecutionHaltOptions,
  type RuntimeExecutionHaltResult,
  type RuntimeExecutionLogRecord as SqliteRuntimeExecutionLogRecord,
  type RuntimeExecutionTerminalResult,
  type RuntimeInitialClaimAcquisitionResult,
  type RuntimeLockAcquisitionResult,
  type RuntimeLockRemovalResult,
  type RuntimeLockStatusResult,
  type RuntimeScopeLockRecord as SqliteRuntimeScopeLockRecord,
  type RuntimeSqliteStore,
} from "../runtime/index.js";
import {
  allowPolicyDecision,
  type GatePolicy,
  type PolicyDecision,
} from "../work-management/policies.js";
import type {
  Qualifier,
  QualifierStatus,
} from "../work-management/qualifiers.js";

/** The repository-level SQLite runtime authority contributed by this package. */
export interface RuntimeClaimAuthorityLocation {
  rootDir: string;
  databasePath: string;
}

export interface RuntimeClaimQualifier extends Qualifier {
  readonly scope: string;
  readonly label: string;
}

export interface RuntimeClaimQualifierInput {
  readonly targetType: string;
  readonly targetId: string;
  readonly claimToken?: string;
  readonly requiredPaths: readonly string[];
}

export interface RuntimeClaimAuthorityContext extends RuntimeClaimQualifierInput {
  readonly rootDir: string;
  readonly authorizeClaim: boolean;
  /** A current claimed-path audit supplied by a guarded caller. */
  readonly claimedPathAudit?: RuntimeChangedFileAuditResult;
}

/** Domain-level claim fact, independent of the runtime authority's row shape. */
export interface RuntimeClaimFact {
  readonly token: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly holder: string;
  readonly state: "active" | "expired";
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastSeenAt?: string;
  readonly metadata?: Record<string, unknown>;
}

/** Domain-level active or released scope-lock fact. */
export interface RuntimeClaimScopeLockFact {
  readonly claimToken: string;
  readonly scopeRef: string;
  readonly lockMode: string;
  readonly policyName: string;
  readonly acquiredAt: string;
  readonly updatedAt: string;
  readonly lifecycleState: "active" | "released";
  readonly releasedAt?: string;
}

/** Domain-level execution fact. */
export interface RuntimeClaimExecutionFact {
  readonly id: number;
  readonly claimToken: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly state: "running" | "completed" | "halted" | "failed";
  readonly reason: string;
  readonly createdAt: string;
}

/** Runtime Claim package projection for Work consumers. */
export interface RuntimeClaimProjectionState {
  readonly claims: RuntimeClaimFact[];
  readonly scopeLocks: RuntimeClaimScopeLockFact[];
}

export interface RuntimeClaimRenewalSuccess {
  readonly outcome: "renewed";
  readonly claimToken: string;
  readonly claim: RuntimeClaimFact;
}

export interface RuntimeClaimRenewalConflict {
  readonly outcome: "conflict";
  readonly claimToken: string;
  readonly conflicts: readonly unknown[];
}

export type RuntimeClaimRenewalResult =
  | RuntimeClaimRenewalSuccess
  | RuntimeClaimRenewalConflict;

export interface RuntimeClaimRenewalWithProjectionState {
  readonly renewal: RuntimeClaimRenewalResult;
  readonly projectionState?: RuntimeClaimProjectionState;
}

/** Runtime facts for one task, projected through the Runtime Claim package. */
export interface RuntimeClaimTaskSnapshot {
  readonly claim: RuntimeClaimFact;
  readonly activeScopeLocks: RuntimeClaimScopeLockFact[];
}

/** Latest execution fact and its active claim-owned lock count for one task. */
export interface RuntimeClaimTaskExecutionSummary {
  readonly execution: RuntimeClaimExecutionFact;
  readonly claim?: RuntimeClaimFact;
  readonly activeLockCount: number;
}

export interface RuntimeClaimPackageContribution {
  readonly id: "runtime-claim";
  projectQualifiers(input: RuntimeClaimQualifierInput): readonly RuntimeClaimQualifier[];
  createAuthorityGatePolicy(): RuntimeClaimAuthorityGatePolicy;
}

/** Command projection boundary for all Claim and lock lifecycle operations. */
export interface RuntimeClaimCommandApi {
  listClaims(): SqliteRuntimeClaimRecord[];
  getClaimStatus(claimToken: string): SqliteRuntimeClaimRecord | undefined;
  renewClaim(
    claimToken: string,
    options?: { readonly now?: Date; readonly ttlMilliseconds?: number },
  ): SqliteRuntimeClaimRenewalResult;
  acquireClaim(
    seed: RuntimeClaimAcquisitionSeed,
    initialLockPaths?: string[],
  ): RuntimeInitialClaimAcquisitionResult;
  releaseClaim(claimToken: string):
    | { outcome: "released"; claim: SqliteRuntimeClaimRecord }
    | { outcome: "missing" };
  cleanupClaim(claimToken: string): RuntimeClaimCleanupResult;
  cleanupExpiredClaims(cutoff: Date): RuntimeClaimCleanupResult;
  acquireLocks(claimToken: string, paths: string[]): RuntimeLockAcquisitionResult;
  removeLocks(claimToken: string, paths: string[]): RuntimeLockRemovalResult;
  getLockStatus(claimToken: string): RuntimeLockStatusResult;
  failExecution(claimToken: string): RuntimeExecutionTerminalResult;
  haltExecution(
    claimToken: string,
    options: RuntimeExecutionHaltOptions,
  ): RuntimeExecutionHaltResult;
}

function gitOutput(rootDir: string, args: string[]): string | undefined {
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

/** Resolve one authority for every worktree attached to a Git repository. */
export function resolveRuntimeClaimAuthority(
  rootDir: string = process.cwd(),
): RuntimeClaimAuthorityLocation {
  const requestedRoot = path.resolve(rootDir);
  const commonDir = gitOutput(requestedRoot, ["rev-parse", "--git-common-dir"]);
  const authorityRoot = commonDir
    ? path.dirname(
        path.resolve(
          path.isAbsolute(commonDir)
            ? commonDir
            : path.resolve(requestedRoot, commonDir),
        ),
      )
    : requestedRoot;
  return {
    rootDir: authorityRoot,
    databasePath: path.join(
      authorityRoot,
      ".doc-vader",
      "runtime",
      "runtime.sqlite",
    ),
  };
}

/** SQLite DataAdapter owned by the Runtime Claim package. */
export class RuntimeClaimSqliteDataAdapter {
  readonly location: RuntimeClaimAuthorityLocation;
  /** Git worktree that supplies runtime changed-file audit facts. */
  readonly gitRootDir: string;
  readonly auditTrace: RuntimeClaimAuditTrace | undefined;
  readonly fullAuditTrace: RuntimeClaimCoverageAuditTrace | undefined;

  constructor(options: {
    readonly rootDir?: string;
    readonly auditTrace?: RuntimeClaimAuditTrace;
    readonly fullAuditTrace?: RuntimeClaimCoverageAuditTrace;
  } = {}) {
    this.gitRootDir = path.resolve(options.rootDir ?? process.cwd());
    this.location = resolveRuntimeClaimAuthority(this.gitRootDir);
    this.auditTrace = options.auditTrace;
    this.fullAuditTrace = options.fullAuditTrace;
  }

  exists(): boolean {
    return existsSync(this.location.databasePath);
  }

  open(): RuntimeSqliteStore {
    const open = () =>
      openRuntimeSqliteStore({
        rootDir: this.location.rootDir,
        gitRootDir: this.gitRootDir,
        databasePath: this.location.databasePath,
        auditTrace: this.auditTrace,
        fullAuditTrace: this.fullAuditTrace,
      });
    return this.auditTrace
      ? this.auditTrace.trace("runtimeClaimSqliteAuthorityOpen", open)
      : open();
  }

  withStore<T>(callback: (store: RuntimeSqliteStore) => T): T {
    const store = this.open();
    try {
      return callback(store);
    } finally {
      store.close();
    }
  }

  withExistingStore<T>(callback: (store: RuntimeSqliteStore) => T): T | undefined {
    return this.exists() ? this.withStore(callback) : undefined;
  }

  getClaimByToken(claimToken: string): SqliteRuntimeClaimRecord | undefined {
    return this.withExistingStore((store) => store.getClaimByToken(claimToken));
  }

  getClaimByTarget(
    targetType: string,
    targetId: string,
  ): SqliteRuntimeClaimRecord | undefined {
    return this.withExistingStore((store) => {
      const lookup = () => store.getClaimByTarget(targetType, targetId);
      return this.auditTrace
        ? this.auditTrace.trace("claimLookup", lookup)
        : lookup();
    });
  }

  projectQualifiers(input: RuntimeClaimQualifierInput): readonly RuntimeClaimQualifier[] {
    const claim = this.getClaimByTarget(input.targetType, input.targetId);
    const scope = `runtime:${input.targetType}:${input.targetId}`;
    const validity = claimValidityStatus(claim, input.claimToken);
    const coverage = lockCompatibilityStatus(claim, input, this);
    return [
      {
        id: "runtime-claim-validity",
        scope,
        scopes: [scope],
        label: "Runtime claim validity",
        status: validity,
      },
      {
        id: "runtime-lock-compatibility",
        scope,
        scopes: [scope],
        label: "Runtime lock compatibility",
        status: coverage,
      },
    ];
  }
}

function toRuntimeClaimFact(record: SqliteRuntimeClaimRecord): RuntimeClaimFact {
  return {
    token: record.claim_token,
    targetType: record.target_type,
    targetId: record.target_id,
    holder: record.holder,
    state: record.state,
    createdAt: record.created_at,
    expiresAt: record.expires_at,
    ...(record.last_seen_at ? { lastSeenAt: record.last_seen_at } : {}),
    ...(record.metadata ? { metadata: record.metadata } : {}),
  };
}

function toRuntimeClaimScopeLockFact(
  record: SqliteRuntimeScopeLockRecord,
): RuntimeClaimScopeLockFact {
  return {
    claimToken: record.claim_token,
    scopeRef: record.scope_ref,
    lockMode: record.lock_mode,
    policyName: record.policy_name,
    acquiredAt: record.acquired_at,
    updatedAt: record.updated_at,
    lifecycleState: record.lifecycle_state,
    ...(record.released_at ? { releasedAt: record.released_at } : {}),
  };
}

function toRuntimeClaimExecutionFact(
  record: SqliteRuntimeExecutionLogRecord,
): RuntimeClaimExecutionFact {
  return {
    id: record.id,
    claimToken: record.claim_token,
    targetType: record.target_type,
    targetId: record.target_id,
    state: record.state,
    reason: record.reason,
    createdAt: record.created_at,
  };
}

function projectRuntimeClaimState(store: RuntimeSqliteStore): RuntimeClaimProjectionState {
  return {
    claims: store.listClaims().map(toRuntimeClaimFact),
    scopeLocks: store.listScopeLocks().map(toRuntimeClaimScopeLockFact),
  };
}

/** Read Runtime Claim facts from the repository-wide runtime authority. */
export function readRuntimeClaimProjection(options: {
  readonly rootDir?: string;
} = {}): RuntimeClaimProjectionState {
  const authority = new RuntimeClaimSqliteDataAdapter(options);
  return authority.withExistingStore(projectRuntimeClaimState) ?? {
    claims: [],
    scopeLocks: [],
  };
}

/** Read task claim facts and only their currently active scope locks. */
export function readRuntimeClaimTaskSnapshots(options: {
  readonly rootDir?: string;
  readonly taskIds: Iterable<string>;
}): Map<string, RuntimeClaimTaskSnapshot> {
  const state = readRuntimeClaimProjection({ rootDir: options.rootDir });
  const claimsByTaskId = new Map(
    state.claims
      .filter((claim) => claim.targetType === "task")
      .map((claim) => [claim.targetId, claim] as const),
  );
  const snapshots = new Map<string, RuntimeClaimTaskSnapshot>();
  for (const taskId of new Set(options.taskIds)) {
    const claim = claimsByTaskId.get(taskId);
    if (!claim) {
      continue;
    }
    snapshots.set(taskId, {
      claim,
      activeScopeLocks: state.scopeLocks.filter(
        (lock) => lock.claimToken === claim.token && lock.lifecycleState === "active",
      ),
    });
  }
  return snapshots;
}

/** Read the latest task execution fact with its authoritative active lock count. */
export function readRuntimeClaimTaskExecutionSummaries(options: {
  readonly rootDir?: string;
  readonly taskIds?: Iterable<string>;
} = {}): Map<string, RuntimeClaimTaskExecutionSummary> {
  const authority = new RuntimeClaimSqliteDataAdapter({ rootDir: options.rootDir });
  return authority.withExistingStore((store) => {
    const taskIdSet = options.taskIds ? new Set(options.taskIds) : undefined;
    const latestByTaskId = new Map<string, SqliteRuntimeExecutionLogRecord>();
    for (const entry of store.listExecutionLogEntries()) {
      if (entry.target_type !== "task" || (taskIdSet && !taskIdSet.has(entry.target_id))) {
        continue;
      }
      const current = latestByTaskId.get(entry.target_id);
      if (!current || entry.created_at > current.created_at ||
        (entry.created_at === current.created_at && entry.id > current.id)) {
        latestByTaskId.set(entry.target_id, entry);
      }
    }
    return new Map(
      [...latestByTaskId.entries()].map(([taskId, entry]) => {
        const claim = store.getClaimByToken(entry.claim_token);
        return [taskId, {
          execution: toRuntimeClaimExecutionFact(entry),
          ...(claim ? { claim: toRuntimeClaimFact(claim) } : {}),
          activeLockCount: store.listLocksByClaimToken(entry.claim_token).length,
        }];
      }),
    );
  }) ?? new Map();
}

/** Renew a claim and capture the resulting domain projection atomically. */
export function renewRuntimeClaimWithProjection(options: {
  readonly rootDir?: string;
  readonly claimToken: string;
  readonly now?: Date;
  readonly ttlMilliseconds?: number;
}): RuntimeClaimRenewalWithProjectionState {
  const authority = new RuntimeClaimSqliteDataAdapter({ rootDir: options.rootDir });
  return authority.withStore((store) => {
    const renewal: SqliteRuntimeClaimRenewalResult = store.renewRuntimeClaim(
      options.claimToken,
      { now: options.now, ttlMilliseconds: options.ttlMilliseconds },
    );
    if (renewal.outcome !== "renewed") {
      return { renewal: { ...renewal } };
    }
    return {
      renewal: {
        outcome: "renewed",
        claimToken: renewal.claimToken,
        claim: toRuntimeClaimFact(renewal.claim),
      },
      projectionState: projectRuntimeClaimState(store),
    };
  });
}

function claimValidityStatus(
  claim: SqliteRuntimeClaimRecord | undefined,
  claimToken: string | undefined,
): QualifierStatus {
  if (!claim) {
    return "not-applicable";
  }
  if (claim.state !== "active" || claimToken !== claim.claim_token) {
    return "unmet";
  }
  return "met";
}

function lockCompatibilityStatus(
  claim: SqliteRuntimeClaimRecord | undefined,
  input: RuntimeClaimQualifierInput,
  adapter: RuntimeClaimSqliteDataAdapter,
): QualifierStatus {
  if (!claim) {
    return "not-applicable";
  }
  if (claim.state !== "active" || input.claimToken !== claim.claim_token) {
    return "unmet";
  }
  const audit = adapter.withStore((store) =>
    store.auditClaimedPaths(claim.claim_token, [...input.requiredPaths]),
  );
  return audit.diagnostics.length === 0 && audit.renameDiagnostics.length === 0
    ? "met"
    : "unmet";
}

/** Enforces active lease validity, including expiry and claim contention. */
export class RuntimeClaimValidityPolicy
  implements GatePolicy<RuntimeClaimAuthorityContext>
{
  readonly id = "runtime-claim-validity";

  evaluate(context: RuntimeClaimAuthorityContext): PolicyDecision {
    if (!context.authorizeClaim) {
      return allowPolicyDecision(this.id);
    }
    const adapter = new RuntimeClaimSqliteDataAdapter({ rootDir: context.rootDir });
    const claim = adapter.getClaimByTarget(context.targetType, context.targetId);
    if (!claim) {
      return allowPolicyDecision(this.id);
    }
    if (claim.state !== "active") {
      return {
        policyId: this.id,
        allowed: false,
        code: "RUNTIME_CLAIM_EXPIRED",
        message: `Runtime claim '${claim.claim_token}' for '${context.targetId}' has expired.`,
        details: { claimToken: claim.claim_token, expiresAt: claim.expires_at },
      };
    }
    if (context.claimToken !== claim.claim_token) {
      return {
        policyId: this.id,
        allowed: false,
        code: "WORK_MUTATION_CLAIM_REQUIRED",
        message: `Work mutation for '${context.targetId}' requires its exact active claim token.`,
        details: {
          taskId: context.targetId,
          expectedClaimToken: claim.claim_token,
          providedClaimToken: context.claimToken,
        },
      };
    }
    return allowPolicyDecision(this.id);
  }
}

function reusableClaimedPathAuditCoversMutation(options: {
  audit: RuntimeChangedFileAuditResult;
  claim: SqliteRuntimeClaimRecord;
  rootDir: string;
  requiredPaths: readonly string[];
}): boolean {
  const auditedPaths = new Set(options.audit.changedPaths);
  return (
    options.audit.claimToken === options.claim.claim_token &&
    options.audit.claim?.claim_token === options.claim.claim_token &&
    options.audit.passed &&
    options.audit.diagnostics.length === 0 &&
    options.audit.renameDiagnostics.length === 0 &&
    options.requiredPaths.every((requiredPath) => {
      try {
        return auditedPaths.has(
          normalizeRuntimeLockPath(requiredPath, {
            rootDir: options.rootDir,
            cwd: options.rootDir,
          }),
        );
      } catch {
        return false;
      }
    })
  );
}

/** Enforces claim-owned path coverage before a durable mutation proceeds. */
export class RuntimeLockCompatibilityPolicy
  implements GatePolicy<RuntimeClaimAuthorityContext>
{
  readonly id = "runtime-lock-compatibility";

  evaluate(context: RuntimeClaimAuthorityContext): PolicyDecision {
    if (!context.authorizeClaim) {
      return allowPolicyDecision(this.id);
    }
    const adapter = new RuntimeClaimSqliteDataAdapter({ rootDir: context.rootDir });
    const claim = adapter.getClaimByTarget(context.targetType, context.targetId);
    if (!claim || claim.state !== "active" || context.claimToken !== claim.claim_token) {
      return allowPolicyDecision(this.id);
    }
    if (context.claimedPathAudit) {
      if (
        reusableClaimedPathAuditCoversMutation({
          audit: context.claimedPathAudit,
          claim,
          rootDir: context.rootDir,
          requiredPaths: context.requiredPaths,
        })
      ) {
        return allowPolicyDecision(this.id);
      }
      return {
        policyId: this.id,
        allowed: false,
        code: "WORK_MUTATION_CLAIM_COVERAGE_REQUIRED",
        message: `Work mutation for '${context.targetId}' requires active claim coverage for every durable path.`,
        details: {
          taskId: context.targetId,
          claimToken: claim.claim_token,
          audit: context.claimedPathAudit,
        },
      };
    }
    const audit = adapter.withStore((store) =>
      store.auditClaimedPaths(claim.claim_token, [...context.requiredPaths]),
    );
    if (audit.diagnostics.length === 0 && audit.renameDiagnostics.length === 0) {
      return allowPolicyDecision(this.id);
    }
    return {
      policyId: this.id,
      allowed: false,
      code: "WORK_MUTATION_CLAIM_COVERAGE_REQUIRED",
      message: `Work mutation for '${context.targetId}' requires active claim coverage for every durable path.`,
      details: { taskId: context.targetId, claimToken: claim.claim_token, audit },
    };
  }
}

/**
 * The Runtime Claim package contribution consumed by Work Item terminal Gates.
 * It deliberately returns policy decisions instead of a Work Item qualifier.
 */
export class RuntimeClaimAuthorityGatePolicy
  implements GatePolicy<RuntimeClaimAuthorityContext>
{
  readonly id = "runtime-claim-authority";
  private readonly validity = new RuntimeClaimValidityPolicy();
  private readonly compatibility = new RuntimeLockCompatibilityPolicy();

  evaluate(context: RuntimeClaimAuthorityContext): PolicyDecision {
    const validity = this.validity.evaluate(context);
    if (!validity.allowed) {
      return validity;
    }
    return this.compatibility.evaluate(context);
  }
}

export function createRuntimeClaimPackage(options: {
  readonly rootDir?: string;
} = {}): RuntimeClaimPackageContribution {
  const dataAdapter = new RuntimeClaimSqliteDataAdapter(options);
  return {
    id: "runtime-claim",
    projectQualifiers: (input) => dataAdapter.projectQualifiers(input),
    createAuthorityGatePolicy: () => new RuntimeClaimAuthorityGatePolicy(),
  };
}

/**
 * Package-owned command operations. CLI and Sandcastle projections consume this
 * boundary rather than opening SQLite or interpreting Claim rows themselves.
 */
export function createRuntimeClaimCommandApi(options: {
  readonly rootDir?: string;
} = {}): RuntimeClaimCommandApi {
  const adapter = new RuntimeClaimSqliteDataAdapter(options);
  return {
    listClaims: () => adapter.withStore((store) => store.listClaims()),
    getClaimStatus: (claimToken) => adapter.withStore((store) => {
      const claim = store.getClaimByToken(claimToken);
      return claim ? store.touchClaimContext(claimToken) : undefined;
    }),
    renewClaim: (claimToken, options = {}) => adapter.withStore((store) =>
      store.renewRuntimeClaim(claimToken, options),
    ),
    acquireClaim: (seed, initialLockPaths = []) => adapter.withStore((store) =>
      store.acquireRuntimeClaim(seed, { initialLockPaths }),
    ),
    releaseClaim: (claimToken) => adapter.withStore((store) => {
      const claim = store.getClaimByToken(claimToken);
      if (!claim) {
        return { outcome: "missing" as const };
      }
      store.deleteLocksByClaimToken(claimToken);
      store.deleteClaim(claimToken);
      return { outcome: "released" as const, claim };
    }),
    cleanupClaim: (claimToken) => adapter.withStore((store) =>
      store.removeRuntimeClaim(claimToken),
    ),
    cleanupExpiredClaims: (cutoff) => adapter.withStore((store) =>
      store.pruneRuntimeClaims(cutoff),
    ),
    acquireLocks: (claimToken, paths) => adapter.withStore((store) =>
      store.acquireRuntimeLocks(claimToken, paths),
    ),
    removeLocks: (claimToken, paths) => adapter.withStore((store) =>
      store.removeRuntimeLocks(claimToken, paths),
    ),
    getLockStatus: (claimToken) => adapter.withStore((store) =>
      store.getLockStatus(claimToken),
    ),
    failExecution: (claimToken) => adapter.withStore((store) =>
      store.failRuntimeExecution(claimToken),
    ),
    haltExecution: (claimToken, halt) => adapter.withStore((store) =>
      store.haltRuntimeExecution(claimToken, halt),
    ),
  };
}

/** Package-owned release authority used by command projections. */
export async function auditRuntimeClaimCoverage(options: {
  readonly rootDir: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly claimToken?: string;
  readonly requiredPaths: readonly string[];
  /** Restrict authorization to explicit mutation paths (for repair operations). */
  readonly requiredPathsOnly?: boolean;
  readonly mergeTargetRef?: string;
  readonly auditTrace?: RuntimeClaimAuditTrace;
  /** Opt-in test/benchmark tracing for the end-to-end full audit only. */
  readonly fullAuditTrace?: RuntimeClaimCoverageAuditTrace;
}): Promise<RuntimeChangedFileAuditResult> {
  const adapter = new RuntimeClaimSqliteDataAdapter({
    rootDir: options.rootDir,
    auditTrace: options.auditTrace,
    fullAuditTrace: options.fullAuditTrace,
  });
  const claim = adapter.getClaimByTarget(options.targetType, options.targetId);
  if (!claim) {
    throw new TaskCommandError(
      "TASK_RUNTIME_CLAIM_MISSING",
      `Task '${options.targetId}' has no active runtime claim.`,
      { taskId: options.targetId },
    );
  }
  if (options.claimToken && options.claimToken !== claim.claim_token) {
    throw new TaskCommandError(
      "WORK_MUTATION_CLAIM_REQUIRED",
      `Task '${options.targetId}' requires its exact active claim token.`,
      {
        taskId: options.targetId,
        expectedClaimToken: claim.claim_token,
        providedClaimToken: options.claimToken,
      },
    );
  }
  const resolveMergeTarget = () => ["main", "master", "HEAD"].find((candidate) => {
    const readMergeTarget = () => {
      const startedAt = performance.now();
      try {
        return gitOutput(adapter.gitRootDir, [
          "rev-parse",
          "--verify",
          "--quiet",
          candidate,
        ]);
      } finally {
        options.fullAuditTrace?.recordDirectGitSubprocess?.(performance.now() - startedAt);
      }
    };
    const output = options.fullAuditTrace
      ? options.fullAuditTrace.trace("gitMergeTargetProbe", readMergeTarget)
      : readMergeTarget();
    options.fullAuditTrace?.recordOutcome?.(
      "gitMergeTargetProbe",
      output === undefined ? "undefined" : "value",
    );
    return output;
  }) ?? "HEAD";
  const mergeTargetRef = options.mergeTargetRef ?? (options.fullAuditTrace
    ? options.fullAuditTrace.trace("mergeTargetResolution", resolveMergeTarget)
    : resolveMergeTarget());
  const runAudit = async () => {
    const store = adapter.open();
    try {
      const currentAudit = options.requiredPathsOnly
        ? undefined
        : await store.auditChangedFiles(claim.claim_token, { mergeTargetRef });
      const requiredAudit = store.auditClaimedPaths(
        claim.claim_token,
        [...options.requiredPaths],
        { mergeTargetRef },
      );
      const diagnostics = [...(currentAudit?.diagnostics ?? [])];
      const seen = new Set(diagnostics.map((diagnostic) =>
        `${diagnostic.path}:${diagnostic.actualLockState}`,
      ));
      for (const diagnostic of requiredAudit.diagnostics) {
        const key = `${diagnostic.path}:${diagnostic.actualLockState}`;
        if (!seen.has(key)) {
          diagnostics.push(diagnostic);
        }
      }
      const changedFiles = [...(currentAudit?.changedFiles ?? []), ...requiredAudit.changedFiles];
      const changedPaths = Array.from(new Set([
        ...(currentAudit?.changedPaths ?? []),
        ...requiredAudit.changedPaths,
      ]));
      const renameDiagnostics = [
        ...(currentAudit?.renameDiagnostics ?? []),
        ...requiredAudit.renameDiagnostics,
      ];
      return {
        ...requiredAudit,
        mergeTargetRef,
        claim,
        changedFiles,
        changedPaths,
        renameDiagnostics,
        diagnostics,
        fresh: (currentAudit?.fresh ?? true) && requiredAudit.fresh,
        mergeable: (currentAudit?.mergeable ?? true) && requiredAudit.mergeable,
        passed:
          (currentAudit?.passed ?? true) &&
          requiredAudit.passed &&
          diagnostics.length === 0 &&
          renameDiagnostics.length === 0,
      };
    } finally {
      store.close();
    }
  };
  return runAudit();
}

/** Verify the exact active task claim without exposing Runtime rows to Work. */
export function assertActiveRuntimeClaimForTask(options: {
  readonly rootDir?: string;
  readonly taskId: string;
  readonly claimToken: string;
}): void {
  const adapter = new RuntimeClaimSqliteDataAdapter({ rootDir: options.rootDir });
  const claim = adapter.withExistingStore((store) => store.getClaimByToken(options.claimToken));
  if (
    !claim ||
    claim.state !== "active" ||
    claim.target_type !== "task" ||
    claim.target_id !== options.taskId
  ) {
    throw new TaskCommandError(
      "WORK_MUTATION_CLAIM_REQUIRED",
      `Work mutation for '${options.taskId}' requires its exact active claim token.`,
      { taskId: options.taskId, providedClaimToken: options.claimToken },
    );
  }
}

export function completeRuntimeClaimExecution(options: {
  readonly rootDir?: string;
  readonly claimToken: string;
}) {
  const adapter = new RuntimeClaimSqliteDataAdapter({ rootDir: options.rootDir });
  if (!adapter.exists()) {
    throw new TaskCommandError(
      "CLAIM_AUTHORITY_UNAVAILABLE",
      `Runtime claim authority is unavailable for repository '${adapter.location.rootDir}'.`,
    );
  }
  return adapter.withStore((store) =>
    store.completeRuntimeExecution(options.claimToken),
  );
}

/**
 * Complete a Work-owned execution without exposing Claim row inspection to the
 * Work terminal caller. The package verifies the target and active lease in
 * the same authority boundary used by its GatePolicy.
 */
export function completeRuntimeClaimExecutionForTask(options: {
  readonly rootDir?: string;
  readonly taskId: string;
  readonly claimToken?: string;
}): RuntimeExecutionTerminalResult | undefined {
  if (!options.claimToken) {
    return undefined;
  }
  const adapter = new RuntimeClaimSqliteDataAdapter({ rootDir: options.rootDir });
  return adapter.withExistingStore((store) => {
    const claim = store.getClaimByToken(options.claimToken!);
    if (
      !claim ||
      claim.state !== "active" ||
      claim.target_type !== "task" ||
      claim.target_id !== options.taskId
    ) {
      return undefined;
    }
    return store.completeRuntimeExecution(options.claimToken!);
  });
}

export function releaseRuntimeClaimAuthority(options: {
  readonly rootDir?: string;
  readonly claimToken: string;
}): void {
  const adapter = new RuntimeClaimSqliteDataAdapter({ rootDir: options.rootDir });
  if (!adapter.exists()) {
    return;
  }
  createRuntimeClaimCommandApi({ rootDir: options.rootDir })
    .releaseClaim(options.claimToken);
}
