import type {
  SubjectResolutionAttempt,
  SubjectResolutionResult,
  SubjectResolverName,
} from "./scan-types.js";

export const DEFAULT_RESOLVER_ORDER: SubjectResolverName[] = [
  "payload_subject_tokens",
  "linked_pull_requests",
];

const SUPPORTED_RESOLVERS = new Set<SubjectResolverName>(
  DEFAULT_RESOLVER_ORDER,
);

function extractUniqueSubjectTokens(input: string): string[] {
  const matches =
    input.match(/\b(?:work-item:[a-z0-9]+(?:-[a-z0-9]+)*|wi-[a-z0-9]+(?:-[a-z0-9]+)*)\b/gi) ??
    [];
  return [...new Set(matches.map((match) => match.toLowerCase()))];
}

function payloadSubjectTokensResolver(
  content: string,
): SubjectResolutionAttempt & { subjects: string[] } {
  const subjects = extractUniqueSubjectTokens(content);
  return {
    strategy: "payload_subject_tokens",
    subjectsFound: subjects.length,
    subjects,
  };
}

function extractPrLinksFromFrontmatter(raw: unknown): string[] {
  // Handle list-of-maps format: links: [{ pull_request: "url" }, ...]
  if (Array.isArray(raw)) {
    return raw.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return [];
      }
      const pr = (entry as Record<string, unknown>)["pull_request"];
      return typeof pr === "string" && pr.trim().length > 0 ? [pr.trim()] : [];
    });
  }
  // Handle object format: links: { pull_requests: ["url", ...] }
  if (typeof raw === "object" && raw !== null) {
    const links = raw as Record<string, unknown>;
    if (Array.isArray(links["pull_requests"])) {
      return (links["pull_requests"] as unknown[]).flatMap(
        (v) => typeof v === "string" && v.trim().length > 0 ? [v.trim()] : [],
      );
    }
  }
  return [];
}

function linkedPullRequestsResolver(
  data: Record<string, unknown>,
): SubjectResolutionAttempt & { subjects: string[] } {
  const id = typeof data["id"] === "string" ? data["id"] : null;
  const validPrLinks = extractPrLinksFromFrontmatter(data["links"]);
  const subjects =
    id && id.startsWith("work-item:") && validPrLinks.length > 0 ? [id] : [];
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
): SubjectResolutionResult {
  const attempts: SubjectResolutionAttempt[] = [];

  for (const strategy of order) {
    if (strategy === "payload_subject_tokens") {
      const attempt = payloadSubjectTokensResolver(content);
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
      const attempt = linkedPullRequestsResolver(data);
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
