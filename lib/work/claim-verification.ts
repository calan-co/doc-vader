import path from "node:path";
import {
  renewRuntimeClaimWithProjection,
  type RuntimeClaimFact,
  type RuntimeClaimRenewalResult,
  type RuntimeClaimRenewalSuccess,
  type RuntimeClaimScopeLockFact,
} from "../runtime-claim/index.js";
import {
  canonicalizeClaimScopeRef,
} from "../runtime/scope-locks.js";
import {
  projectWorkGraph,
  type ProjectWorkGraphOptions,
  type RuntimeProjectionState,
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
  scopeLock: RuntimeClaimScopeLockFact,
): boolean {
  const claimNodeId = toClaimNodeId(scopeLock.claimToken);
  const scopeNodeId = toScopeNodeId(scopeLock.scopeRef);
  return projection.getEdgesByType("locks").some((edge) => {
    return (
      edge.from === claimNodeId &&
      edge.to === scopeNodeId &&
      edge.properties.claimToken === scopeLock.claimToken &&
      edge.properties.scopeRef === scopeLock.scopeRef &&
      edge.properties.lockMode === scopeLock.lockMode &&
      edge.properties.policyName === scopeLock.policyName &&
      edge.properties.lifecycleState === "active"
    );
  });
}

function collectVerificationDiagnostics(options: {
  projection: WorkGraphProjection;
  claim: RuntimeClaimFact;
  activeScopeLocks: RuntimeClaimScopeLockFact[];
}): WorkGraphVerificationDiagnostic[] {
  const diagnostics: WorkGraphVerificationDiagnostic[] = [];
  const claimNodeId = toClaimNodeId(options.claim.token);
  const claimNode = options.projection.findNode(claimNodeId);
  if (!claimNode) {
    diagnostics.push({
      kind: "missing-node",
      nodeId: claimNodeId,
      detail: `Missing claim node '${claimNodeId}' after mutation.`,
    });
  }

  const targetScopeRef = canonicalizeClaimScopeRef(
    options.claim.targetType,
    options.claim.targetId,
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
    const scopeNodeId = toScopeNodeId(scopeLock.scopeRef);
    if (!options.projection.findNode(scopeNodeId)) {
      diagnostics.push({
        kind: "missing-node",
        nodeId: scopeNodeId,
        detail: `Missing scope node '${scopeNodeId}' for scope lock '${scopeLock.scopeRef}'.`,
      });
      continue;
    }
    if (!hasLockEdge(options.projection, scopeLock)) {
      diagnostics.push({
        kind: "missing-edge",
        edgeType: "locks",
        from: claimNodeId,
        to: scopeNodeId,
        detail: `Missing locks edge '${claimNodeId}' -> '${scopeNodeId}' for ${scopeLock.lockMode} scope '${scopeLock.scopeRef}'.`,
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
  claim: RuntimeClaimFact;
  activeScopeLocks: RuntimeClaimScopeLockFact[];
}): RenewWorkClaimWithGraphVerificationSuccess["verification"]["lineage"] {
  const claimNodeId = toClaimNodeId(options.claim.token);
  const workItemNodeId = canonicalizeClaimScopeRef(
    options.claim.targetType,
    options.claim.targetId,
  );
  const scopeNodeIds = [
    toScopeNodeId(workItemNodeId),
    ...options.activeScopeLocks.map((scopeLock) =>
      toScopeNodeId(scopeLock.scopeRef),
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

  const renewedAuthorityState = renewRuntimeClaimWithProjection({
    rootDir,
    claimToken: options.claimToken,
    now: options.now,
    ttlMilliseconds: options.ttlMilliseconds,
  });
  const renewal: RuntimeClaimRenewalResult = renewedAuthorityState.renewal;
  const postRenewalRuntimeState: RuntimeProjectionState | undefined =
    renewedAuthorityState.projectionState;
  const activeScopeLocks = (postRenewalRuntimeState?.scopeLocks ?? []).filter(
    (lock) =>
      lock.claimToken === options.claimToken &&
      lock.lifecycleState === "active",
  );

  if (renewal.outcome !== "renewed") {
    return renewal;
  }

  const after = await project({
    rootDir,
    workspaceDirs,
    runtimeState: postRenewalRuntimeState,
  });
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
        claimNodeId: toClaimNodeId(renewal.claim.token),
        lockEdgeCount: countLockEdgesForClaim(before, renewal.claim.token),
      },
      after: {
        claimNodeId: toClaimNodeId(renewal.claim.token),
        lockEdgeCount: countLockEdgesForClaim(after, renewal.claim.token),
      },
      lineage: collectVerificationLineage({
        projection: after,
        claim: renewal.claim,
        activeScopeLocks,
      }),
    },
  };
}
