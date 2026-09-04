type JsonObject = Record<string, unknown>;

export type WorkItemGovernanceReasonCode =
  | "archived"
  | "blocked"
  | "closed"
  | "dependency_blocked"
  | "dependency_state_unknown"
  | "invalid"
  | "hitl"
  | "missing_classification"
  | "missing_completed_date"
  | "missing_evidence"
  | "missing_status_reason"
  | "not_active"
  | "not_ready";

export interface WorkItemGovernanceReason {
  code: WorkItemGovernanceReasonCode;
  message: string;
  details?: JsonObject;
}

export interface WorkItemGovernanceDependency {
  id: string;
  ref: string;
  status?: string;
  lifecycle?: string;
  filePath?: string;
  satisfied: boolean;
  stateKnown: boolean;
}

export interface WorkItemGovernanceRecord {
  id: string;
  title?: string;
  status?: string;
  lifecycle?: string;
  tags?: string[];
  archived?: boolean;
  statusReason?: string;
  completedDate?: string;
  links?: JsonObject;
  dependencies?: WorkItemGovernanceDependency[];
}

export interface WorkItemGovernanceVerdict {
  schemaVersion: "work-item-governance/v1";
  record: {
    id: string;
    title?: string;
    status: string;
    lifecycle: string;
    tags: string[];
    archived: boolean;
  };
  lifecycle: {
    valid: boolean;
    isActive: boolean;
    isArchived: boolean;
    isClosed: boolean;
    reasons: WorkItemGovernanceReason[];
  };
  classification: {
    isAfk: boolean;
    isHitl: boolean;
    reasons: WorkItemGovernanceReason[];
  };
  dependencies: {
    satisfied: boolean;
    known: boolean;
    reasons: WorkItemGovernanceReason[];
    items: WorkItemGovernanceDependency[];
  };
  evidence: {
    ready: boolean;
    reasons: WorkItemGovernanceReason[];
  };
  archive: {
    eligible: boolean;
    reasons: WorkItemGovernanceReason[];
  };
  readiness: {
    ready: boolean;
    reasons: WorkItemGovernanceReason[];
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }
  return [
    ...new Set(
      tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === "string" && value.trim().length > 0) {
    return [value.trim()];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getEvidenceLinks(links: JsonObject | undefined): string[] {
  return collectStringValues(links?.evidence);
}

function reason(
  code: WorkItemGovernanceReasonCode,
  message: string,
  details?: JsonObject,
): WorkItemGovernanceReason {
  return { code, message, ...(details ? { details } : {}) };
}

function normalizeDependency(dependency: WorkItemGovernanceDependency): WorkItemGovernanceDependency {
  return {
    ...dependency,
    id: dependency.id.trim(),
    ref: dependency.ref.trim(),
    ...(dependency.status ? { status: dependency.status.trim() } : {}),
    ...(dependency.lifecycle ? { lifecycle: dependency.lifecycle.trim() } : {}),
    ...(dependency.filePath ? { filePath: dependency.filePath.trim() } : {}),
  };
}

function dependencySummary(
  dependencies: WorkItemGovernanceDependency[],
): {
  satisfied: boolean;
  known: boolean;
  reasons: WorkItemGovernanceReason[];
} {
  const unknownDependencies = dependencies.filter((dependency) => !dependency.stateKnown);
  const blockedDependencies = dependencies.filter(
    (dependency) => dependency.stateKnown && !dependency.satisfied,
  );

  const reasons: WorkItemGovernanceReason[] = [];
  if (unknownDependencies.length > 0) {
    reasons.push(
      reason("dependency_state_unknown", "Dependency state could not be determined.", {
        dependencies: unknownDependencies,
      }),
    );
  }
  if (blockedDependencies.length > 0) {
    reasons.push(
      reason("dependency_blocked", "Task has unsatisfied dependencies.", {
        dependencies: blockedDependencies,
      }),
    );
  }

  return {
    satisfied: unknownDependencies.length === 0 && blockedDependencies.length === 0,
    known: unknownDependencies.length === 0,
    reasons,
  };
}

function lifecycleSummary(record: WorkItemGovernanceRecord): {
  valid: boolean;
  isActive: boolean;
  isArchived: boolean;
  isClosed: boolean;
  reasons: WorkItemGovernanceReason[];
  status: string;
  lifecycle: string;
} {
  const id = asString(record.id);
  const status = asString(record.status);
  const lifecycle = asString(record.lifecycle);
  const archived = record.archived === true || lifecycle === "archived";
  const reasons: WorkItemGovernanceReason[] = [];

  if (!id || !status || !lifecycle) {
    reasons.push(
      reason("invalid", "Task is missing required ready-selection metadata.", {
        missing: [
          ...(!id ? ["id"] : []),
          ...(!status ? ["status"] : []),
          ...(!lifecycle ? ["lifecycle"] : []),
        ],
      }),
    );
  }
  if (archived) {
    reasons.push(reason("archived", "Archived tasks are not ready candidates."));
  }
  if (["closed", "completed", "aborted"].includes(status ?? "") || lifecycle === "inactive") {
    reasons.push(reason("closed", "Closed tasks are not ready candidates."));
  }
  if (status === "blocked") {
    reasons.push(reason("blocked", "Blocked tasks are not ready candidates."));
  }
  if (status === "dependency-blocked") {
    reasons.push(
      reason("dependency_blocked", "Dependency-blocked tasks are not ready candidates."),
    );
  }
  if (status !== "ready") {
    reasons.push(reason("not_ready", "Task status is not ready.", { status }));
  }
  if (lifecycle !== "active") {
    reasons.push(reason("not_active", "Task lifecycle is not active.", { lifecycle }));
  }

  return {
    valid: Boolean(id && status && lifecycle),
    isActive: lifecycle === "active",
    isArchived: archived,
    isClosed: ["closed", "completed", "aborted"].includes(status ?? "") || lifecycle === "inactive",
    reasons,
    status: status ?? "",
    lifecycle: lifecycle ?? "",
  };
}

function classificationSummary(
  tags: string[],
): {
  isAfk: boolean;
  isHitl: boolean;
  reasons: WorkItemGovernanceReason[];
} {
  const isHitl = tags.includes("hitl");
  const isAfk = !isHitl;
  const reasons: WorkItemGovernanceReason[] = [];

  if (isHitl) {
    reasons.push(reason("hitl", "HITL tasks are not AFK-ready candidates."));
  }

  return {
    isAfk,
    isHitl,
    reasons,
  };
}

function evidenceSummary(record: WorkItemGovernanceRecord): {
  ready: boolean;
  reasons: WorkItemGovernanceReason[];
} {
  const status = asString(record.status) ?? "";
  if (!["completed", "aborted"].includes(status)) {
    return { ready: true, reasons: [] };
  }

  const reasons: WorkItemGovernanceReason[] = [];
  if (!asString(record.statusReason)) {
    reasons.push(
      reason("missing_status_reason", "Terminal work item is missing status_reason."),
    );
  }
  if (!asString(record.completedDate)) {
    reasons.push(
      reason("missing_completed_date", "Terminal work item is missing completed_date."),
    );
  }
  if (getEvidenceLinks(record.links).length === 0) {
    reasons.push(
      reason("missing_evidence", "Terminal work item is missing evidence links."),
    );
  }

  return {
    ready: reasons.length === 0,
    reasons,
  };
}

function archiveSummary(
  lifecycle: ReturnType<typeof lifecycleSummary>,
  evidence: ReturnType<typeof evidenceSummary>,
): {
  eligible: boolean;
  reasons: WorkItemGovernanceReason[];
} {
  const status = lifecycle.status;
  if (!["completed", "aborted"].includes(status)) {
    return {
      eligible: false,
      reasons: [
        reason("not_ready", "Work item is not in an archive-eligible terminal status.", {
          status,
        }),
      ],
    };
  }

  if (!evidence.ready) {
    return {
      eligible: false,
      reasons: evidence.reasons,
    };
  }

  return {
    eligible: true,
    reasons: [],
  };
}

export function evaluateWorkItemGovernance(
  record: WorkItemGovernanceRecord,
): WorkItemGovernanceVerdict {
  const id = asString(record.id) ?? "";
  const title = asString(record.title);
  const tags = normalizeTags(record.tags);
  const normalizedDependencies = (record.dependencies ?? []).map((dependency) =>
    normalizeDependency(dependency),
  );
  const lifecycle = lifecycleSummary(record);
  const status = lifecycle.status;
  const lifecycleValue = lifecycle.lifecycle;
  const classification = classificationSummary(tags);
  const dependencies = dependencySummary(normalizedDependencies);
  const evidence = evidenceSummary(record);
  const archive = archiveSummary(lifecycle, evidence);

  const readinessReasons = [
    ...lifecycle.reasons,
    ...classification.reasons,
    ...dependencies.reasons,
  ];

  return {
    schemaVersion: "work-item-governance/v1",
    record: {
      id,
      ...(title ? { title } : {}),
      status,
      lifecycle: lifecycleValue,
      tags,
      archived: lifecycle.isArchived,
    },
    lifecycle,
    classification,
    dependencies: {
      ...dependencies,
      items: normalizedDependencies,
    },
    evidence,
    archive,
    readiness: {
      ready: readinessReasons.length === 0,
      reasons: readinessReasons,
    },
  };
}
