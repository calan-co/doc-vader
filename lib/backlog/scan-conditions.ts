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
