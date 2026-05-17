import type {
  SubjectResolutionAttempt,
  SubjectResolutionResult,
  SubjectResolverName,
} from "./scan-types.js";
import {
  extractStringValuesAtPath,
  extractSubjectTokens,
  matchesWorkItemId,
  normalizePullRequestPath,
} from "./configurable-rules.js";

export const DEFAULT_RESOLVER_ORDER: SubjectResolverName[] = [
  "payload_subject_tokens",
  "linked_pull_requests",
];

const SUPPORTED_RESOLVERS = new Set<SubjectResolverName>(
  DEFAULT_RESOLVER_ORDER,
);

function extractUniqueSubjectTokens(input: string, patterns?: string[]): string[] {
  return extractSubjectTokens(input, patterns);
}

function payloadSubjectTokensResolver(
  content: string,
  workItemMatchPatterns?: string[],
): SubjectResolutionAttempt & { subjects: string[] } {
  const subjects = extractUniqueSubjectTokens(content, workItemMatchPatterns);
  return {
    strategy: "payload_subject_tokens",
    subjectsFound: subjects.length,
    subjects,
  };
}

function extractPrLinksFromFrontmatter(
  data: Record<string, unknown>,
  pullRequestPath?: string,
): string[] {
  return extractStringValuesAtPath(data, normalizePullRequestPath(pullRequestPath));
}

function linkedPullRequestsResolver(
  data: Record<string, unknown>,
  pullRequestPath?: string,
  workItemMatchPatterns?: string[],
): SubjectResolutionAttempt & { subjects: string[] } {
  const id = typeof data["id"] === "string" ? data["id"] : null;
  const validPrLinks = extractPrLinksFromFrontmatter(data, pullRequestPath);
  const subjects =
    id && matchesWorkItemId(id, workItemMatchPatterns) && validPrLinks.length > 0
      ? [id]
      : [];
  return {
    strategy: "linked_pull_requests",
    subjectsFound: subjects.length,
    subjects,
  };
}

export function normalizeResolverOrder(
  order?: SubjectResolverName[],
): SubjectResolverName[] {
  if (!order || order.length === 0) {
    return [...DEFAULT_RESOLVER_ORDER];
  }

  const normalized: SubjectResolverName[] = [];
  for (const name of order) {
    if (!SUPPORTED_RESOLVERS.has(name)) {
      throw new Error(
        `Unsupported resolver '${name}'. Supported resolvers: ${DEFAULT_RESOLVER_ORDER.join(
          ", ",
        )}`,
      );
    }
    if (!normalized.includes(name)) {
      normalized.push(name);
    }
  }

  return normalized;
}

export function resolveSubjects(
  content: string,
  data: Record<string, unknown>,
  order: SubjectResolverName[],
  options?: {
    pullRequestPath?: string;
    workItemMatchPatterns?: string[];
  },
): SubjectResolutionResult {
  const attempts: SubjectResolutionAttempt[] = [];

  for (const strategy of order) {
    if (strategy === "payload_subject_tokens") {
      const attempt = payloadSubjectTokensResolver(
        content,
        options?.workItemMatchPatterns,
      );
      attempts.push({
        strategy: attempt.strategy,
        subjectsFound: attempt.subjectsFound,
      });
      if (attempt.subjects.length > 0) {
        return {
          subjects: attempt.subjects,
          strategyUsed: strategy,
          attempts,
        };
      }
      continue;
    }

    if (strategy === "linked_pull_requests") {
      const attempt = linkedPullRequestsResolver(
        data,
        options?.pullRequestPath,
        options?.workItemMatchPatterns,
      );
      attempts.push({
        strategy: attempt.strategy,
        subjectsFound: attempt.subjectsFound,
      });
      if (attempt.subjects.length > 0) {
        return {
          subjects: attempt.subjects,
          strategyUsed: strategy,
          attempts,
        };
      }
    }
  }

  return {
    subjects: [],
    strategyUsed: null,
    attempts,
  };
}
