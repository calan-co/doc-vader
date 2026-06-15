import type { ScanCondition, ScanError } from "./scan-types.js";
import {
  extractStringValuesAtPath,
  normalizePullRequestPath,
} from "./configurable-rules.js";

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

function hasEvidenceEntry(raw: unknown): boolean {
  if (Array.isArray(raw)) {
    return raw.some((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return false;
      }
      const evidence = (entry as Record<string, unknown>)["evidence"];
      return typeof evidence === "string" && evidence.trim().length > 0;
    });
  }

  if (typeof raw === "object" && raw !== null) {
    const evidence = (raw as Record<string, unknown>)["evidence"];
    if (Array.isArray(evidence)) {
      return evidence.some(
        (entry) => typeof entry === "string" && entry.trim().length > 0,
      );
    }
    return typeof evidence === "string" && evidence.trim().length > 0;
  }

  return false;
}

export function conditionValidEvidence(
  data: Record<string, unknown>,
): ScanCondition {
  // Evidence is only required for terminal work items; all other statuses pass unconditionally.
  if (!["completed", "aborted"].includes(String(data["status"] ?? ""))) {
    return { code: "valid_evidence", value: true };
  }
  return {
    code: "valid_evidence",
    value: hasEvidenceEntry(data["links"]),
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
