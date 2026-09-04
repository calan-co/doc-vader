import type { ScanCondition, ScanError } from "./scan-types.js";
import {
  extractStringValuesAtPath,
  normalizePullRequestPath,
} from "./configurable-rules.js";
import { evaluateWorkItemGovernance } from "../work-management/kernel.js";

const TERMINAL_WORK_ITEM_STATUSES = new Set(["completed", "aborted"]);

/** Presence of an `id` field. */
export function conditionHasId(id: unknown): ScanCondition {
  return {
    code: "has_id",
    value: typeof id === "string" && id.trim().length > 0,
  };
}

/** Presence of a `status` field. */
export function conditionHasStatus(status: unknown): ScanCondition {
  return {
    code: "has_status",
    value: typeof status === "string" && status.trim().length > 0,
  };
}

/** Presence of a `lifecycle` field. */
export function conditionHasLifecycle(lifecycle: unknown): ScanCondition {
  return {
    code: "has_lifecycle",
    value: typeof lifecycle === "string" && lifecycle.trim().length > 0,
  };
}

/** Presence of any wikilinks in the `links` / `dependencies` block. */
export function conditionHasLinksBlock(
  data: Record<string, unknown>,
): ScanCondition {
  const links = data["links"] ?? data["dependencies"] ?? data["refs"];
  const hasLinks =
    links !== undefined &&
    links !== null &&
    (Array.isArray(links)
      ? links.length > 0
      : typeof links === "string" && links.trim().length > 0);
  return { code: "has_links_block", value: hasLinks };
}

function extractLinkedPrs(
  data: Record<string, unknown>,
  pullRequestPath?: string,
): string[] {
  const normalizedPath = normalizePullRequestPath(pullRequestPath);
  return extractStringValuesAtPath(data, normalizedPath);
}

export function conditionPrLinkFound(
  data: Record<string, unknown>,
  pullRequestPath?: string,
): ScanCondition {
  return {
    code: "pr_link_found",
    value: extractLinkedPrs(data, pullRequestPath).length > 0,
  };
}

export function conditionPrMerged(
  data: Record<string, unknown>,
): ScanCondition {
  const merged = data["pr_merged"];
  return { code: "pr_merged", value: merged === true };
}

export function conditionWorkflowSucceeded(
  data: Record<string, unknown>,
): ScanCondition {
  const succeeded = data["workflow_succeeded"];
  return { code: "workflow_succeeded", value: succeeded === true };
}

function getStringField(
  data: Record<string, unknown>,
  field: string,
): string | undefined {
  return typeof data[field] === "string" ? data[field] : undefined;
}

function getRecordField(
  data: Record<string, unknown>,
  field: string,
): Record<string, unknown> | undefined {
  const value = data[field];
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function toWorkItemGovernanceInput(data: Record<string, unknown>) {
  return {
    id: getStringField(data, "id") ?? "",
    status: getStringField(data, "status"),
    lifecycle: getStringField(data, "lifecycle"),
    statusReason: getStringField(data, "status_reason"),
    completedDate: getStringField(data, "completed_date"),
    links: getRecordField(data, "links"),
  };
}

export function conditionValidEvidence(
  data: Record<string, unknown>,
): ScanCondition {
  const status = getStringField(data, "status");
  if (!TERMINAL_WORK_ITEM_STATUSES.has(status ?? "")) {
    return { code: "valid_evidence", value: true };
  }

  const governance = evaluateWorkItemGovernance(toWorkItemGovernanceInput(data));

  return {
    code: "valid_evidence",
    value: governance.evidence.ready,
  };
}

export function conditionValidStatus(
  data: Record<string, unknown>,
): ScanCondition {
  const status = data["status"];
  return {
    code: "valid_status",
    value: typeof status === "string" && status.trim().length > 0,
  };
}

/** Build condition list and error list for a parsed work item. */
export function evaluateConditions(
  data: Record<string, unknown>,
  options?: { pullRequestPath?: string },
): {
  conditions: ScanCondition[];
  errors: ScanError[];
} {
  const conditions: ScanCondition[] = [
    { code: "file_parsed", value: true },
    conditionHasId(data["id"]),
    conditionHasStatus(data["status"]),
    conditionHasLifecycle(data["lifecycle"]),
    conditionHasLinksBlock(data),
    conditionPrLinkFound(data, options?.pullRequestPath),
    conditionPrMerged(data),
    conditionWorkflowSucceeded(data),
    conditionValidEvidence(data),
    conditionValidStatus(data),
  ];

  const errors: ScanError[] = [];

  if (!conditions.find((c) => c.code === "has_id")!.value) {
    errors.push({
      code: "missing_id",
      message: "Frontmatter is missing required field: id",
    });
  }
  if (!conditions.find((c) => c.code === "has_status")!.value) {
    errors.push({
      code: "missing_status",
      message: "Frontmatter is missing required field: status",
    });
  }

  return { conditions, errors };
}
