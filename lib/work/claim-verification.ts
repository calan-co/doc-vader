import path from "node:path";
import {
  openRuntimeSqliteStore,
  type RuntimeClaimRecord,
  type RuntimeClaimRenewalResult,
  type RuntimeClaimRenewalSuccess,
  type RuntimeScopeLockRecord,
} from "../runtime/sqlite-store.js";
import {
  canonicalizeClaimScopeRef,
} from "../runtime/scope-locks.js";
import {
  projectWorkGraph,
  type ProjectWorkGraphOptions,
  type WorkGraphEdge,
  type WorkGraphProjection,
} from "./projection.js";

export type WorkGraphVerificationDiagnostic =
  | {
      kind: "missing-node";
      nodeId: string;
      detail: string;
    }
  | {
      kind: "missing-edge";
      edgeType: WorkGraphEdge["type"];
      from: string;
      to: string;
      detail: string;
    };

export class WorkGraphVerificationError extends Error {
  readonly code = "WORK_GRAPH_VERIFICATION_FAILED";
  readonly claimToken: string;
  readonly diagnostics: readonly WorkGraphVerificationDiagnostic[];

  constructor(options: {
    claimToken: string;
    diagnostics: WorkGraphVerificationDiagnostic[];
  }) {
    super(
      options.diagnostics.map((diagnostic) => diagnostic.detail).join(" "),
    );
    this.name = "WorkGraphVerificationError";
    this.claimToken = options.claimToken;
    this.diagnostics = options.diagnostics;
  }
}

export interface RenewWorkClaimWithGraphVerificationOptions
  extends Pick<ProjectWorkGraphOptions, "workspaceDirs"> {
  claimToken: string;
  rootDir?: string;
  now?: Date;
  ttlMilliseconds?: number;
  project?: (
    options: ProjectWorkGraphOptions,
  ) => Promise<WorkGraphProjection>;
}

export interface RenewWorkClaimWithGraphVerificationSuccess
  extends RuntimeClaimRenewalSuccess {
  verification: {
    before: {
      claimNodeId: string;
      lockEdgeCount: number;
    };
    after: {
      claimNodeId: string;
      lockEdgeCount: number;
    };
    lineage: {
      claim: VerificationLineageEntry[];
      scopes: VerificationLineageEntry[];
      workItems: VerificationLineageEntry[];
    };
  };
}

export type RenewWorkClaimWithGraphVerificationResult =
  | RuntimeClaimRenewalResult
  | RenewWorkClaimWithGraphVerificationSuccess;

interface VerificationLineageEntry {
  recordId: string;
  recordKind: string;
  targetNodeId: string;
}

function toClaimNodeId(claimToken: string): string {
  return `claim:${claimToken}`;
}

function toScopeNodeId(scopeRef: string): string {
  return `scope:${scopeRef}`;
}

function countLockEdgesForClaim(
  projection: WorkGraphProjection,
  claimToken: string,
): number {
  const claimNodeId = toClaimNodeId(claimToken);
  return projection
    .getEdgesByType("locks")
    .filter((edge) => edge.from === claimNodeId).length;
}

function hasLockEdge(
  projection: WorkGraphProjection,
  scopeLock: RuntimeScopeLockRecord,
): boolean {
  const claimNodeId = toClaimNodeId(scopeLock.claim_token);
  const scopeNodeId = toScopeNodeId(scopeLock.scope_ref);
  return projection.getEdgesByType("locks").some((edge) => {
    return (
      edge.from === claimNodeId &&
      edge.to === scopeNodeId &&
      edge.properties.claimToken === scopeLock.claim_token &&
      edge.properties.scopeRef === scopeLock.scope_ref &&
      edge.properties.lockMode === scopeLock.lock_mode &&
      edge.properties.policyName === scopeLock.policy_name &&
      edge.properties.lifecycleState === "active"
    );
  });
}

function collectVerificationDiagnostics(options: {
  projection: WorkGraphProjection;
  claim: RuntimeClaimRecord;
  activeScopeLocks: RuntimeScopeLockRecord[];
}): WorkGraphVerificationDiagnostic[] {
  const diagnostics: WorkGraphVerificationDiagnostic[] = [];
  const claimNodeId = toClaimNodeId(options.claim.claim_token);
  const claimNode = options.projection.findNode(claimNodeId);
  if (!claimNode) {
    diagnostics.push({
      kind: "missing-node",
      nodeId: claimNodeId,
      detail: `Missing claim node '${claimNodeId}' after mutation.`,
    });
  }

  const targetScopeRef = canonicalizeClaimScopeRef(
    options.claim.target_type,
    options.claim.target_id,
  );
  const targetScopeNodeId = toScopeNodeId(targetScopeRef);
  if (!options.projection.findNode(targetScopeNodeId)) {
    diagnostics.push({
      kind: "missing-node",
      nodeId: targetScopeNodeId,
      detail: `Missing scope node '${targetScopeNodeId}' after mutation.`,
    });
  }

  const belongsToEdge = options.projection
    .getOutgoingEdges(claimNodeId)
    .find((edge) => edge.type === "belongs_to" && edge.to === targetScopeNodeId);
  if (!belongsToEdge) {
    diagnostics.push({
      kind: "missing-edge",
      edgeType: "belongs_to",
      from: claimNodeId,
      to: targetScopeNodeId,
      detail: `Missing belongs_to edge '${claimNodeId}' -> '${targetScopeNodeId}' after mutation.`,
    });
  }

  for (const scopeLock of options.activeScopeLocks) {
    const scopeNodeId = toScopeNodeId(scopeLock.scope_ref);
    if (!options.projection.findNode(scopeNodeId)) {
      diagnostics.push({
        kind: "missing-node",
        nodeId: scopeNodeId,
        detail: `Missing scope node '${scopeNodeId}' for scope lock '${scopeLock.scope_ref}'.`,
      });
      continue;
    }
    if (!hasLockEdge(options.projection, scopeLock)) {
      diagnostics.push({
        kind: "missing-edge",
        edgeType: "locks",
        from: claimNodeId,
        to: scopeNodeId,
        detail: `Missing locks edge '${claimNodeId}' -> '${scopeNodeId}' for ${scopeLock.lock_mode} scope '${scopeLock.scope_ref}'.`,
      });
    }
  }

  return diagnostics;
}

function collectLineageEntries(
  projection: WorkGraphProjection,
  targetNodeIds: readonly string[],
): VerificationLineageEntry[] {
  const targetIdSet = new Set(targetNodeIds);
  return projection
    .getEdgesByType("records")
    .filter((edge) => targetIdSet.has(edge.to))
    .map((edge) => ({
      recordId: edge.from,
      recordKind:
        typeof edge.properties.recordKind === "string"
          ? edge.properties.recordKind
          : "record",
      targetNodeId: edge.to,
    }));
}

function collectVerificationLineage(options: {
  projection: WorkGraphProjection;
  claim: RuntimeClaimRecord;
  activeScopeLocks: RuntimeScopeLockRecord[];
}): RenewWorkClaimWithGraphVerificationSuccess["verification"]["lineage"] {
  const claimNodeId = toClaimNodeId(options.claim.claim_token);
  const workItemNodeId = canonicalizeClaimScopeRef(
    options.claim.target_type,
    options.claim.target_id,
  );
  const scopeNodeIds = [
    toScopeNodeId(workItemNodeId),
    ...options.activeScopeLocks.map((scopeLock) =>
      toScopeNodeId(scopeLock.scope_ref),
    ),
  ].sort((left, right) => left.localeCompare(right));

  return {
    claim: collectLineageEntries(options.projection, [claimNodeId]),
    scopes: collectLineageEntries(options.projection, scopeNodeIds),
    workItems: collectLineageEntries(options.projection, [workItemNodeId]),
  };
}

export async function renewWorkClaimWithGraphVerification(
  options: RenewWorkClaimWithGraphVerificationOptions,
): Promise<RenewWorkClaimWithGraphVerificationResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const workspaceDirs = options.workspaceDirs;
  const project = options.project ?? projectWorkGraph;

  const before = await project({ rootDir, workspaceDirs });

  const store = openRuntimeSqliteStore({ rootDir });
  let renewal: RuntimeClaimRenewalResult;
  let activeScopeLocks: RuntimeScopeLockRecord[] = [];
  try {
    renewal = store.renewRuntimeClaim(options.claimToken, {
      now: options.now,
      ttlMilliseconds: options.ttlMilliseconds,
    });
    if (renewal.outcome === "renewed") {
      activeScopeLocks = store
        .listScopeLocksByClaimToken(options.claimToken)
        .filter((lock) => lock.lifecycle_state === "active");
    }
  } finally {
    store.close();
  }

  if (renewal.outcome !== "renewed") {
    return renewal;
  }

  const after = await project({ rootDir, workspaceDirs });
  const diagnostics = collectVerificationDiagnostics({
    projection: after,
    claim: renewal.claim,
    activeScopeLocks,
  });
  if (diagnostics.length > 0) {
    throw new WorkGraphVerificationError({
      claimToken: options.claimToken,
      diagnostics,
    });
  }

  return {
    ...renewal,
    verification: {
      before: {
        claimNodeId: toClaimNodeId(renewal.claim.claim_token),
        lockEdgeCount: countLockEdgesForClaim(before, renewal.claim.claim_token),
      },
      after: {
        claimNodeId: toClaimNodeId(renewal.claim.claim_token),
        lockEdgeCount: countLockEdgesForClaim(after, renewal.claim.claim_token),
      },
      lineage: collectVerificationLineage({
        projection: after,
        claim: renewal.claim,
        activeScopeLocks,
      }),
    },
  };
}
