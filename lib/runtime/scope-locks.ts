import { canonicalizeScopeRef, canonicalizeWorkItemScopeRef } from "../work/index.js";
import { RUNTIME_SCHEMA_VERSION } from "./entity-schemas.js";

export const RUNTIME_SCOPE_LOCK_POLICY_NAMES = [
  "ReadLockPolicy",
  "WriteLockPolicy",
  "ExecuteLockPolicy",
] as const;

export const RUNTIME_SCOPE_LOCK_MODES = [
  "read",
  "write",
  "execute",
] as const;

export const RUNTIME_SCOPE_LOCK_LIFECYCLE_STATES = [
  "active",
  "released",
] as const;

export type RuntimeScopeLockPolicyName =
  (typeof RUNTIME_SCOPE_LOCK_POLICY_NAMES)[number];

export type RuntimeScopeLockMode = (typeof RUNTIME_SCOPE_LOCK_MODES)[number];

export type RuntimeScopeLockLifecycleState =
  (typeof RUNTIME_SCOPE_LOCK_LIFECYCLE_STATES)[number];

export interface RuntimeScopeLock {
  schema_version: typeof RUNTIME_SCHEMA_VERSION;
  claim_token: string;
  scope_ref: string;
  lock_mode: RuntimeScopeLockMode;
  policy_name: RuntimeScopeLockPolicyName;
  acquired_at: string;
  updated_at: string;
  lifecycle_state: RuntimeScopeLockLifecycleState;
  released_at?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeScopeLockConflict {
  scope_ref: string;
  requested_mode: RuntimeScopeLockMode;
  conflicting_modes: RuntimeScopeLockMode[];
  policy_name: RuntimeScopeLockPolicyName;
}

export interface RuntimeScopeLockPolicyDecision {
  allowed: boolean;
  conflict?: RuntimeScopeLockConflict;
}

function pairIsCompatible(
  existingMode: RuntimeScopeLockMode,
  requestedMode: RuntimeScopeLockMode,
): boolean {
  return (
    (existingMode === "read" && requestedMode === "read") ||
    (existingMode === "read" && requestedMode === "execute") ||
    (existingMode === "execute" && requestedMode === "read")
  );
}

export function evaluateRuntimeScopeLockPolicy(
  requestedMode: RuntimeScopeLockMode,
  existingModes: readonly RuntimeScopeLockMode[],
  scopeRef: string,
  policyName: RuntimeScopeLockPolicyName,
): RuntimeScopeLockPolicyDecision {
  const conflictingModes = [...new Set(existingModes)].filter(
    (existingMode) => !pairIsCompatible(existingMode, requestedMode),
  );

  if (conflictingModes.length > 0) {
    return {
      allowed: false,
      conflict: {
        scope_ref: scopeRef,
        requested_mode: requestedMode,
        conflicting_modes: conflictingModes,
        policy_name: policyName,
      },
    };
  }

  return { allowed: true };
}

export function ReadLockPolicy(
  existingModes: readonly RuntimeScopeLockMode[],
  scopeRef: string,
): RuntimeScopeLockPolicyDecision {
  return evaluateRuntimeScopeLockPolicy(
    "read",
    existingModes,
    scopeRef,
    "ReadLockPolicy",
  );
}

export function WriteLockPolicy(
  existingModes: readonly RuntimeScopeLockMode[],
  scopeRef: string,
): RuntimeScopeLockPolicyDecision {
  return evaluateRuntimeScopeLockPolicy(
    "write",
    existingModes,
    scopeRef,
    "WriteLockPolicy",
  );
}

export function ExecuteLockPolicy(
  existingModes: readonly RuntimeScopeLockMode[],
  scopeRef: string,
): RuntimeScopeLockPolicyDecision {
  return evaluateRuntimeScopeLockPolicy(
    "execute",
    existingModes,
    scopeRef,
    "ExecuteLockPolicy",
  );
}

export function canonicalizeRuntimeScopeRef(value: string): string {
  return canonicalizeScopeRef(value);
}

export function canonicalizeClaimScopeRef(
  targetType: string,
  targetId: string,
): string {
  const normalizedTargetType = targetType.trim().toLowerCase();
  if (normalizedTargetType === "task" || normalizedTargetType === "work-item") {
    return canonicalizeWorkItemScopeRef(targetId);
  }
  return canonicalizeRuntimeScopeRef(targetId);
}
