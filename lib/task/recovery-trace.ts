import { performance } from "node:perf_hooks";
import type { RuntimeClaimAuditTrace } from "../runtime/index.js";

export const TASK_RECOVERY_TRACE_ENV = "DOC_VADER_TEST_RECOVERY_TRACE";

export const RECOVERY_TRACE_STAGES = [
  "cliTsxBootstrap",
  "taskRuntimeLoading",
  "gitSafetyState",
  "claimAcquisition",
  "dryRunTransition",
  "appliedTransition",
  "runtimeClaimSqliteAuthorityOpen",
  "claimLookup",
  "scopeLockLookup",
  "gitRevParseAbbrevRefHead",
  "gitRevParseHead",
  "requiredPathNormalization",
  "lockOwnershipDecision",
] as const;

export type RecoveryTraceStage = (typeof RECOVERY_TRACE_STAGES)[number];

export interface RecoveryTraceStageTiming {
  durationMs: number;
  invocationCount: number;
}

export type RecoveryAuditSubspan = Extract<
  RecoveryTraceStage,
  | "runtimeClaimSqliteAuthorityOpen"
  | "claimLookup"
  | "scopeLockLookup"
  | "gitRevParseAbbrevRefHead"
  | "gitRevParseHead"
  | "requiredPathNormalization"
  | "lockOwnershipDecision"
>;

export interface RecoveryTrace {
  operationOnlyMs: number;
  stages: Record<RecoveryTraceStage, RecoveryTraceStageTiming>;
  dominantStage: RecoveryTraceStage;
  dominantAuditSubspan: RecoveryAuditSubspan;
}

export function createRecoveryTrace(): RecoveryTrace {
  return {
    operationOnlyMs: 0,
    stages: Object.fromEntries(
      RECOVERY_TRACE_STAGES.map((stage) => [
        stage,
        { durationMs: 0, invocationCount: 0 },
      ]),
    ) as Record<RecoveryTraceStage, RecoveryTraceStageTiming>,
    dominantStage: "cliTsxBootstrap",
    dominantAuditSubspan: "runtimeClaimSqliteAuthorityOpen",
  };
}

export function traceRecoveryStage<T>(
  trace: RecoveryTrace | undefined,
  stage: RecoveryTraceStage,
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

export async function traceRecoveryStageAsync<T>(
  trace: RecoveryTrace | undefined,
  stage: RecoveryTraceStage,
  operation: () => Promise<T>,
): Promise<T> {
  if (!trace) {
    return operation();
  }

  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    const timing = trace.stages[stage];
    timing.durationMs += performance.now() - startedAt;
    timing.invocationCount += 1;
  }
}

export function createRecoveryAuditTrace(
  trace: RecoveryTrace | undefined,
): RuntimeClaimAuditTrace | undefined {
  if (!trace) {
    return undefined;
  }
  return {
    trace: (stage, operation) => traceRecoveryStage(trace, stage, operation),
  };
}

export function finalizeRecoveryTrace(trace: RecoveryTrace): RecoveryTrace {
  trace.dominantStage = [...RECOVERY_TRACE_STAGES].sort((left, right) => {
    const durationDifference =
      trace.stages[right].durationMs - trace.stages[left].durationMs;
    return durationDifference ||
      RECOVERY_TRACE_STAGES.indexOf(left) - RECOVERY_TRACE_STAGES.indexOf(right);
  })[0];
  trace.dominantAuditSubspan = RECOVERY_TRACE_STAGES.filter(
    (stage): stage is RecoveryAuditSubspan =>
      stage === "runtimeClaimSqliteAuthorityOpen" ||
      stage === "claimLookup" ||
      stage === "scopeLockLookup" ||
      stage === "gitRevParseAbbrevRefHead" ||
      stage === "gitRevParseHead" ||
      stage === "requiredPathNormalization" ||
      stage === "lockOwnershipDecision",
  ).sort((left, right) => {
    const durationDifference =
      trace.stages[right].durationMs - trace.stages[left].durationMs;
    return durationDifference ||
      RECOVERY_TRACE_STAGES.indexOf(left) - RECOVERY_TRACE_STAGES.indexOf(right);
  })[0];
  return trace;
}
