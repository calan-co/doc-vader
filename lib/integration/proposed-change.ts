import {
  classifyOperationalArtifact,
  type OperationalArtifactReason,
} from "../operational-artifacts.js";

export const PROPOSED_CHANGE_MANIFEST_SCHEMA_VERSION = "proposed-change/v1" as const;

export type ProposedChangeClassification =
  | "governed"
  | "ignored"
  | "binary"
  | "unknown";

/** A VCS-neutral record of one selected change. */
export interface ProposedChange {
  path: string;
  classification: ProposedChangeClassification;
}

export interface ProposedChangeException {
  id: string;
  path: string;
  reason: string;
  approvedBy: string;
  approvedAt: string;
}

export interface ProposedChangeManifest {
  schemaVersion: typeof PROPOSED_CHANGE_MANIFEST_SCHEMA_VERSION;
  changes: ProposedChange[];
  exceptions?: ProposedChangeException[];
}

export type ProposedChangeRejectionCode =
  | "OPERATIONAL_ARTIFACT"
  | "IGNORED_ARTIFACT"
  | "BINARY_ARTIFACT"
  | "UNKNOWN_ARTIFACT"
  | "INVALID_EXCEPTION";

export interface ProposedChangeRejectedArtifact {
  path: string;
  classification: ProposedChangeClassification;
  code: ProposedChangeRejectionCode;
  reason: string;
}

export interface ProposedChangeExceptionEvidence {
  id: string;
  path: string;
  disposition: "applied" | "rejected";
  reason: string;
}

export interface ProposedChangeIntegrationEvidence {
  schemaVersion: typeof PROPOSED_CHANGE_MANIFEST_SCHEMA_VERSION;
  accepted: ProposedChange[];
  rejected: ProposedChangeRejectedArtifact[];
  exceptions: ProposedChangeExceptionEvidence[];
}

export interface ProposedChangeManifestEvaluation {
  allowed: boolean;
  evidence: ProposedChangeIntegrationEvidence;
}

function exceptionIsStructured(exception: ProposedChangeException): boolean {
  return (
    exception.id.trim().length > 0 &&
    exception.path.trim().length > 0 &&
    exception.reason.trim().length > 0 &&
    exception.approvedBy.trim().length > 0 &&
    !Number.isNaN(Date.parse(exception.approvedAt))
  );
}

function rejectionForClassification(
  change: ProposedChange,
): ProposedChangeRejectedArtifact {
  switch (change.classification) {
    case "ignored":
      return {
        ...change,
        code: "IGNORED_ARTIFACT",
        reason: "Ignored artifacts require an explicit integration exception.",
      };
    case "binary":
      return {
        ...change,
        code: "BINARY_ARTIFACT",
        reason: "Binary artifacts require an explicit integration exception.",
      };
    case "unknown":
    default:
      return {
        ...change,
        code: "UNKNOWN_ARTIFACT",
        reason: "Unknown artifacts are rejected until explicitly classified.",
      };
  }
}

function operationalRejection(options: {
  change: ProposedChange;
  reason: OperationalArtifactReason;
}): ProposedChangeRejectedArtifact {
  return {
    ...options.change,
    code: "OPERATIONAL_ARTIFACT",
    reason: `Operational ${options.reason} artifacts are not durable deliverables.`,
  };
}

/**
 * Evaluates a manifest before target-workspace application. It has no Git
 * dependency: a VCS adapter supplies the selected-change classifications.
 */
export function evaluateProposedChangeManifest(
  manifest: ProposedChangeManifest,
): ProposedChangeManifestEvaluation {
  const accepted: ProposedChange[] = [];
  const rejected: ProposedChangeRejectedArtifact[] = [];
  const exceptions: ProposedChangeExceptionEvidence[] = [];
  const exceptionsByPath = new Map<string, ProposedChangeException>();
  const consumedExceptionPaths = new Set<string>();

  for (const exception of manifest.exceptions ?? []) {
    if (!exceptionIsStructured(exception)) {
      exceptions.push({
        id: exception.id,
        path: exception.path,
        disposition: "rejected",
        reason: "Exceptions require id, path, reason, approver, and approval timestamp.",
      });
      continue;
    }
    if (exceptionsByPath.has(exception.path)) {
      exceptions.push({
        id: exception.id,
        path: exception.path,
        disposition: "rejected",
        reason: "Only one exception may apply to a selected path.",
      });
      continue;
    }
    exceptionsByPath.set(exception.path, exception);
  }

  for (const change of manifest.changes) {
    const operational = classifyOperationalArtifact(change.path);
    const exception = exceptionsByPath.get(change.path);
    if (operational.kind === "operational") {
      rejected.push(operationalRejection({ change, reason: operational.reason }));
      if (exception) {
        consumedExceptionPaths.add(exception.path);
        exceptions.push({
          id: exception.id,
          path: change.path,
          disposition: "rejected",
          reason: "Operational artifacts cannot be exceptioned into durable delivery.",
        });
      }
      continue;
    }

    if (change.classification === "governed") {
      accepted.push(change);
      if (exception) {
        consumedExceptionPaths.add(exception.path);
        exceptions.push({
          id: exception.id,
          path: change.path,
          disposition: "rejected",
          reason: "Exceptions only apply to otherwise forbidden selected artifacts.",
        });
      }
      continue;
    }

    if (change.classification === "unknown") {
      rejected.push(rejectionForClassification(change));
      if (exception) {
        consumedExceptionPaths.add(exception.path);
        exceptions.push({
          id: exception.id,
          path: change.path,
          disposition: "rejected",
          reason: "Unknown artifacts must be explicitly classified before delivery.",
        });
      }
      continue;
    }

    if (exception) {
      consumedExceptionPaths.add(exception.path);
      accepted.push(change);
      exceptions.push({
        id: exception.id,
        path: change.path,
        disposition: "applied",
        reason: exception.reason,
      });
      continue;
    }
    rejected.push(rejectionForClassification(change));
  }

  for (const exception of exceptionsByPath.values()) {
    if (consumedExceptionPaths.has(exception.path)) {
      continue;
    }
    exceptions.push({
      id: exception.id,
      path: exception.path,
      disposition: "rejected",
      reason: "Exceptions must reference a selected change.",
    });
  }

  return {
    allowed: rejected.length === 0 && exceptions.every((entry) => entry.disposition === "applied"),
    evidence: {
      schemaVersion: PROPOSED_CHANGE_MANIFEST_SCHEMA_VERSION,
      accepted,
      rejected,
      exceptions,
    },
  };
}

/**
 * VCS adapters call this gate before commit or publish. The adapter remains
 * responsible for discovering ignored/binary state; Doc-Vader only evaluates
 * the supplied selection and emits auditable evidence.
 */
export function evaluateSelectedVcsChanges(
  changes: ProposedChange[],
  exceptions?: ProposedChangeException[],
): ProposedChangeManifestEvaluation {
  return evaluateProposedChangeManifest({
    schemaVersion: PROPOSED_CHANGE_MANIFEST_SCHEMA_VERSION,
    changes,
    ...(exceptions ? { exceptions } : {}),
  });
}
