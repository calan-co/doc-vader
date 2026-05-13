import matter from "gray-matter";

export type WorkItemValidationStatus = "ready-for-review" | "closed";

export interface WorkItemContext {
  path: string | undefined;
  body: string;
  frontmatter: Record<string, unknown>;
  status: string | undefined;
  isWorkItem: boolean;
  isArchived: boolean;
  isActiveBacklogWorkItem: boolean;
}

export interface ValidationIssue {
  code: string;
  message: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseWorkItemContext(file: {
  path?: string;
  value?: unknown;
}): WorkItemContext {
  const raw =
    typeof file.value === "string" ? file.value : String(file.value ?? "");
  const parsed = matter(raw);
  const frontmatter = asRecord(parsed.data);
  const normalizedPath = file.path?.replace(/\\/g, "/");
  const isArchived = normalizedPath?.includes("/backlog/archive/") ?? false;
  const isBacklogFile = normalizedPath?.includes("/backlog/") ?? false;
  const isWorkItem = frontmatter.type === "work-item";

  return {
    path: file.path,
    body: parsed.content,
    frontmatter,
    status:
      typeof frontmatter.status === "string" ? frontmatter.status : undefined,
    isWorkItem,
    isArchived,
    isActiveBacklogWorkItem: isBacklogFile && !isArchived && isWorkItem,
  };
}

export function hasClosureEvidenceNote(body: string): boolean {
  return /^-\s+\d{4}-\d{2}-\d{2}:\s+Closed\s+as\s+.+\s+with\s+evidence\s+in\s+.+$/im.test(
    body,
  );
}

export function validateArchiveReadiness(
  context: WorkItemContext,
  statuses: readonly WorkItemValidationStatus[],
): ValidationIssue[] {
  if (!context.isActiveBacklogWorkItem) return [];
  if (
    !context.status ||
    !statuses.includes(context.status as WorkItemValidationStatus)
  ) {
    return [];
  }

  const issues: ValidationIssue[] = [];
  const links = asRecord(context.frontmatter.links);
  const pullRequests = asArray(links.pull_requests).filter(hasNonEmptyString);
  const evidence = asArray(links.evidence).filter(hasNonEmptyString);
  const actual = context.frontmatter.actual;

  if (pullRequests.length === 0) {
    issues.push({
      code: "missing-pull-requests",
      message:
        "[work-item-archive-readiness] Missing links.pull_requests for archive candidate.",
    });
  }

  if (evidence.length === 0) {
    issues.push({
      code: "missing-evidence",
      message:
        "[work-item-archive-readiness] Missing links.evidence for archive candidate.",
    });
  }

  if (typeof actual !== "number" || Number.isNaN(actual)) {
    issues.push({
      code: "missing-actual",
      message:
        "[work-item-archive-readiness] Missing numeric actual effort for archive candidate.",
    });
  }

  return issues;
}

export function validateClosedWorkItemEvidence(
  context: WorkItemContext,
): ValidationIssue[] {
  if (!context.isActiveBacklogWorkItem || context.status !== "closed")
    return [];

  const issues: ValidationIssue[] = [];

  if (!hasNonEmptyString(context.frontmatter.status_reason)) {
    issues.push({
      code: "missing-status-reason",
      message:
        "[work-item-closure-evidence] Closed work item is missing status_reason.",
    });
  }

  if (!hasNonEmptyString(context.frontmatter.completed_date)) {
    issues.push({
      code: "missing-completed-date",
      message:
        "[work-item-closure-evidence] Closed work item is missing completed_date.",
    });
  }

  if (!hasClosureEvidenceNote(context.body)) {
    issues.push({
      code: "missing-closure-note",
      message:
        "[work-item-closure-evidence] Closed work item is missing a closure note with evidence.",
    });
  }

  return issues;
}
