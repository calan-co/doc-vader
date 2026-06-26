export { canonicalizeScopeRef, canonicalizeWorkItemScopeRef } from "./scope-ref.js";
export {
  createProjectionPort,
  createWorkProjectionPort,
  projectRepositoryGraph,
  projectWorkGraph,
  type WorkGraphProjection,
  type WorkGraphProjectionDiagnostic,
  type WorkGraphProjectionDiagnosticClassification,
  type WorkGraphProjectionDiagnosticReasonCode,
  type ProjectWorkGraphOptions,
  type WorkGraphEdge,
  type WorkGraphEdgeType,
  type WorkGraphNode,
  type WorkGraphNodeType,
} from "./projection.js";
export {
  WorkGraphVerificationError,
  renewWorkClaimWithGraphVerification,
  type RenewWorkClaimWithGraphVerificationOptions,
  type RenewWorkClaimWithGraphVerificationResult,
  type RenewWorkClaimWithGraphVerificationSuccess,
  type WorkGraphVerificationDiagnostic,
} from "./claim-verification.js";

export {
  TaskCommandError as WorkCommandError,
  toTaskErrorPayload as toWorkErrorPayload,
  type TaskErrorPayload as WorkErrorPayload,
} from "../task/errors.js";
export {
  claimTask as claimWork,
  completeTaskClaim as completeWorkClaim,
  assertTaskClaimable as assertWorkClaimable,
} from "../task/index.js";
export {
  loadCanonicalTask as loadCanonicalWork,
  stableTaskJson as stableWorkJson,
  renderHumanTask as renderHumanWork,
  renderSandcastlePrompt as renderSandcastleWorkPrompt,
  TaskModelError as WorkModelError,
  type CanonicalTaskAcceptanceCriterion as CanonicalWorkAcceptanceCriterion,
  type CanonicalTaskBodySection as CanonicalWorkBodySection,
  type CanonicalTaskDependency as CanonicalWorkDependency,
  type CanonicalTaskModel as CanonicalWorkModel,
  type LoadCanonicalTaskOptions as LoadCanonicalWorkOptions,
  type RenderCanonicalTaskOptions as RenderCanonicalWorkOptions,
  type StructuredTaskModelError as StructuredWorkModelError,
  type TaskModelErrorCode as WorkModelErrorCode,
} from "../task/canonical.js";
export {
  collectTaskRecoveryGitState as collectWorkRecoveryGitState,
  isRecoverableReadyRuntimeState,
  type TaskRecoveryGitState as WorkRecoveryGitState,
  type TaskRecoveryForceMode as WorkRecoveryForceMode,
} from "../task/index.js";
export {
  loadTaskModel as loadWorkModel,
  listTaskModels as listWorkModels,
  type LoadTaskOptions as LoadWorkOptions,
  type TaskModel as WorkModel,
} from "../task/model.js";
export {
  readRecordPayload as readWorkRecordPayload,
  recordTaskEvidence as recordWorkEvidence,
} from "../task/record.js";
export {
  recoverTaskClaim as recoverWorkClaim,
} from "../task/recover.js";
export { selectReadyTasks as selectReadyWorkItems } from "../task/ready.js";
export {
  formatReadyPorcelain,
  formatReadyText,
} from "../task/ready.js";
export {
  resolveGitRoot as resolveWorkRoot,
  resolveTaskAuthority as resolveWorkAuthority,
  resolveTaskAuthorityFromGitContext as resolveWorkAuthorityFromGitContext,
  type TaskAuthorityGitContext as WorkAuthorityGitContext,
} from "../task/authority.js";
