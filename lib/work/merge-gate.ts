import matter from "gray-matter";

export interface PullRequestWorkItemSource {
  filePath: string;
  content: string;
}

export interface PullRequestWorkItemValidationInput {
  pullRequestUrl: string;
  changedPaths: string[];
  workItems: PullRequestWorkItemSource[];
}

export interface PullRequestWorkItemValidationResult {
  errors: string[];
}

const DOCUMENTATION_ONLY_DIRECTORIES = ["backlog/", "docs/"];
const DOCUMENTATION_ONLY_FILES = ["README.md", "CHANGELOG.md", "LICENSE"];

function isDocumentationOnlyPath(filePath: string): boolean {
  return (
    DOCUMENTATION_ONLY_FILES.includes(filePath) ||
    DOCUMENTATION_ONLY_DIRECTORIES.some((directory) => filePath.startsWith(directory))
  );
}

function sectionBody(markdown: string, heading: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingPattern = new RegExp(`^##\\s+${escapedHeading}\\s*$`, "i");
  const headingIndex = lines.findIndex((line) => headingPattern.test(line));

  if (headingIndex < 0) return null;

  const body: string[] = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index] ?? "")) break;
    body.push(lines[index] ?? "");
  }
  return body.join("\n");
}

function checklistErrors(filePath: string, markdown: string): string[] {
  const errors: string[] = [];
  for (const heading of ["Tasks", "Acceptance Criteria"]) {
    const body = sectionBody(markdown, heading);
    if (body === null) {
      errors.push(`${filePath}: missing section '## ${heading}'.`);
      continue;
    }

    const checks = [...body.matchAll(/^\s*-\s*\[([ xX])\]\s+/gm)];
    if (checks.length === 0) {
      errors.push(`${filePath}: section '## ${heading}' has no checklist items.`);
      continue;
    }

    const unchecked = checks.filter((match) => match[1] === " ").length;
    if (unchecked > 0) {
      errors.push(
        `${filePath}: section '## ${heading}' has ${unchecked} unchecked checklist item(s).`,
      );
    }
  }
  return errors;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

function isCompletedWorkItem(frontmatter: Record<string, unknown>, filePath: string): string[] {
  const errors: string[] = [];
  if (frontmatter.status !== "completed") {
    errors.push(`${filePath}: status must be 'completed' before its pull request can merge.`);
  }
  if (typeof frontmatter.status_reason !== "string" || frontmatter.status_reason.trim() === "") {
    errors.push(`${filePath}: completed work items require status_reason.`);
  }
  if (!isValidDate(frontmatter.completed_date)) {
    errors.push(`${filePath}: completed work items require a valid completed_date in YYYY-MM-DD form.`);
  }
  if (typeof frontmatter.actual !== "number" || !Number.isFinite(frontmatter.actual)) {
    errors.push(`${filePath}: completed work items require numeric actual effort.`);
  }

  const links = frontmatter.links;
  const evidence =
    typeof links === "object" && links !== null && !Array.isArray(links)
      ? stringList((links as Record<string, unknown>).evidence)
      : [];
  if (evidence.length === 0) {
    errors.push(`${filePath}: completed work items require links.evidence.`);
  }
  return errors;
}

export function validatePullRequestWorkItems(
  input: PullRequestWorkItemValidationInput,
): PullRequestWorkItemValidationResult {
  const implementationChange = input.changedPaths.some(
    (filePath) => !isDocumentationOnlyPath(filePath),
  );
  if (!implementationChange) return { errors: [] };

  const matches = input.workItems.flatMap(({ filePath, content }) => {
    const parsed = matter(content);
    const frontmatter = parsed.data as Record<string, unknown>;
    if (frontmatter.type !== "work-item") return [];
    const links = frontmatter.links;
    const pullRequests =
      typeof links === "object" && links !== null && !Array.isArray(links)
        ? stringList((links as Record<string, unknown>).pull_requests)
        : [];
    return pullRequests.includes(input.pullRequestUrl)
      ? [{ filePath, frontmatter, content: parsed.content }]
      : [];
  });

  if (matches.length === 0) {
    return {
      errors: [
        "implementation pull requests require exactly one Work item linked through links.pull_requests.",
      ],
    };
  }
  if (matches.length !== 1) {
    return {
      errors: [
        `implementation pull requests must link exactly one Work item; found ${matches.length}.`,
      ],
    };
  }

  const [{ filePath, frontmatter, content }] = matches;
  return {
    errors: [
      ...isCompletedWorkItem(frontmatter, filePath),
      ...checklistErrors(filePath, content),
    ],
  };
}
