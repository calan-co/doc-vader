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

function sectionBodies(markdown: string, heading: string): string[] {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingPattern = new RegExp(`^##\\s+${escapedHeading}\\s*$`, "i");
  const sections: string[] = [];
  let body: string[] | null = null;
  let fenced = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (headingPattern.test(line)) {
      if (body !== null) sections.push(body.join("\n"));
      body = [];
      continue;
    }
    if (/^##\s+/.test(line)) {
      if (body !== null) sections.push(body.join("\n"));
      body = null;
      continue;
    }
    body?.push(line);
  }
  if (body !== null) sections.push(body.join("\n"));
  return sections;
}

export function checklistErrors(filePath: string, markdown: string): string[] {
  const errors: string[] = [];
  for (const heading of ["Tasks", "Acceptance Criteria"]) {
    const bodies = sectionBodies(markdown, heading);
    if (bodies.length === 0) {
      errors.push(`${filePath}: missing section '## ${heading}'.`);
      continue;
    }
    if (bodies.length > 1) {
      errors.push(`${filePath}: duplicate section '## ${heading}'.`);
      continue;
    }

    const checks = [...bodies[0].matchAll(/^\s*(?:[-*+]|\d+\.)[ \t]+\[([ xX])\]\s+/gm)];
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

function isLink(value: string): boolean {
  if (/^\[\[[^\]|\r\n]+(?:\|[^\]|\r\n]+)?\]\][\p{P}\s]*$/u.test(value)) return true;
  try {
    return /^\S+:\/\/\S+$/.test(value) && new URL(value).hostname !== "";
  } catch {
    return false;
  }
}

function isPullRequestUrl(value: string): boolean {
  return /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/[1-9]\d*$/.test(value);
}

function stringList(value: unknown, isValidEntry = isLink): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return [];
  const entries = value.map((entry) => entry.trim());
  return entries.length > 0 && entries.every(isValidEntry) ? entries : [];
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
  if (
    typeof frontmatter.actual !== "number" ||
    !Number.isFinite(frontmatter.actual) ||
    frontmatter.actual < 0
  ) {
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
    const language = matter.language(content).name.trim().toLowerCase();
    if (language && language !== "yaml") {
      throw new Error(`${filePath}: only YAML front matter is allowed.`);
    }
    const parsed = matter(content, { language: "yaml" });
    const frontmatter = parsed.data as Record<string, unknown>;
    if (frontmatter.type !== "work-item" || frontmatter.lifecycle !== "active") return [];
    const links = frontmatter.links;
    const pullRequests =
      typeof links === "object" && links !== null && !Array.isArray(links)
        ? stringList((links as Record<string, unknown>).pull_requests, isPullRequestUrl)
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
