import type { ScanCondition, ScanError } from "./scan-types.js";

/** Presence of an `id` field. */
export function conditionHasId(id: unknown): ScanCondition {
  return { code: "has_id", value: typeof id === "string" && id.trim().length > 0 };
}

/** Presence of a `status` field. */
export function conditionHasStatus(status: unknown): ScanCondition {
  return { code: "has_status", value: typeof status === "string" && status.trim().length > 0 };
}

/** Presence of a `lifecycle` field. */
export function conditionHasLifecycle(lifecycle: unknown): ScanCondition {
  return {
    code: "has_lifecycle",
    value: typeof lifecycle === "string" && lifecycle.trim().length > 0,
  };
}

/** Presence of any wikilinks in the `links` / `dependencies` block. */
export function conditionHasLinksBlock(data: Record<string, unknown>): ScanCondition {
  const links = data["links"] ?? data["dependencies"] ?? data["refs"];
  const hasLinks =
    links !== undefined &&
    links !== null &&
    (Array.isArray(links) ? links.length > 0 : typeof links === "string" && links.trim().length > 0);
  return { code: "has_links_block", value: hasLinks };
}

function extractLinkedPrs(data: Record<string, unknown>): string[] {
  const links = data["links"];
  if (typeof links !== "object" || links === null) {
    return [];
  }
  const mapped = (links as Record<string, unknown>)["pull_requests"];
  if (!Array.isArray(mapped)) {
    return [];
  }
  return mapped.filter((v): v is string => typeof v === "string" && v.length > 0);
}

export function conditionPrLinkFound(data: Record<string, unknown>): ScanCondition {
  return { code: "pr_link_found", value: extractLinkedPrs(data).length > 0 };
}

export function conditionPrMerged(data: Record<string, unknown>): ScanCondition {
  const merged = data["pr_merged"];
  return { code: "pr_merged", value: merged === true };
}

export function conditionWorkflowSucceeded(data: Record<string, unknown>): ScanCondition {
  const succeeded = data["workflow_succeeded"];
  return { code: "workflow_succeeded", value: succeeded === true };
}

export function conditionValidStatus(data: Record<string, unknown>): ScanCondition {
  const status = data["status"];
  return {
    code: "valid_status",
    value: typeof status === "string" && status.trim().length > 0,
  };
}

/** Build condition list and error list for a parsed work item. */
export function evaluateConditions(
  data: Record<string, unknown>
): { conditions: ScanCondition[]; errors: ScanError[] } {
  const conditions: ScanCondition[] = [
    { code: "file_parsed", value: true },
    conditionHasId(data["id"]),
    conditionHasStatus(data["status"]),
    conditionHasLifecycle(data["lifecycle"]),
    conditionHasLinksBlock(data),
    conditionPrLinkFound(data),
    conditionPrMerged(data),
    conditionWorkflowSucceeded(data),
    conditionValidStatus(data),
  ];

  const errors: ScanError[] = [];

  if (!conditions.find((c) => c.code === "has_id")!.value) {
    errors.push({ code: "missing_id", message: "Frontmatter is missing required field: id" });
  }
  if (!conditions.find((c) => c.code === "has_status")!.value) {
    errors.push({ code: "missing_status", message: "Frontmatter is missing required field: status" });
  }

  return { conditions, errors };
}
