/**
 * Subject Resolver Interfaces and Chain Executor
 *
 * Phase B refactoring: Defines resolver pattern for multi-strategy subject resolution.
 * Each resolver strategy can use BacklogAutomationProvider for vendor-specific operations.
 */

import type {
  SubjectResolverName,
  SubjectResolutionAttempt,
  SubjectResolutionResult,
} from "./scan-types.js";
import type { BacklogAutomationProvider, PRIdentity } from "./provider.js";

/**
 * SubjectResolver interface - each strategy resolves subjects using different approaches.
 */
export interface SubjectResolver {
  /**
   * Get the strategy name.
   */
  name(): SubjectResolverName;

  /**
   * Attempt to resolve subjects from the work item.
   * Should return both the subjects found and detailed information about the attempt.
   */
  resolve(context: SubjectResolverContext): Promise<SubjectResolutionAttempt & { subjects: string[] }>;
}

/**
 * Context passed to each resolver strategy.
 */
export interface SubjectResolverContext {
  /** Full file content (markdown with frontmatter) */
  content: string;
  /** Parsed frontmatter data */
  data: Record<string, unknown>;
  /** Work item ID (if present) */
  id: string | null;
  /** Provider for vendor-specific operations */
  provider: BacklogAutomationProvider;
}

/**
 * PayloadSubjectTokensResolver
 *
 * Strategy 1: Extract subject tokens directly from file content.
 * Looks for work-item:* patterns in the markdown body.
 *
 * This is the fast, local-only strategy with no external dependencies.
 */
export class PayloadSubjectTokensResolver implements SubjectResolver {
  name(): SubjectResolverName {
    return "payload_subject_tokens";
  }

  async resolve(context: SubjectResolverContext): Promise<SubjectResolutionAttempt & { subjects: string[] }> {
    const subjects = this.extractUniqueSubjectTokens(context.content);
    return {
      strategy: this.name(),
      subjectsFound: subjects.length,
      subjects,
    };
  }

  private extractUniqueSubjectTokens(input: string): string[] {
    const matches = input.match(/work-item:[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
    return [...new Set(matches)];
  }
}

/**
 * LinkedPullRequestsResolver
 *
 * Strategy 2: If work item has linked PRs, use them to resolve subjects.
 *
 * Two modes:
 * - With authentication: Fetches PR metadata via provider to validate they're merged
 * - Without authentication: Just checks for PR links (Phase A behavior, no network calls)
 *
 * This allows the resolver to work in both CI/CD (with auth) and local/test environments.
 */
export class LinkedPullRequestsResolver implements SubjectResolver {
  name(): SubjectResolverName {
    return "linked_pull_requests";
  }

  async resolve(context: SubjectResolverContext): Promise<SubjectResolutionAttempt & { subjects: string[] }> {
    const { id, data, provider } = context;

    // Only resolve if we have a valid work-item ID
    if (!id || !id.startsWith("work-item:")) {
      return {
        strategy: this.name(),
        subjectsFound: 0,
        subjects: [],
      };
    }

    // Extract PR links from frontmatter
    const prLinks = this.extractPrLinksFromFrontmatter(data["links"]);
    if (prLinks.length === 0) {
      return {
        strategy: this.name(),
        subjectsFound: 0,
        subjects: [],
      };
    }

    // If provider is authenticated, fetch and validate PR metadata
    if (provider.isAuthenticated()) {
      return this.resolveWithAuthentication(id, prLinks, provider);
    }

    // Without auth, just check for PR links (Phase A fallback behavior)
    return {
      strategy: this.name(),
      subjectsFound: 1,
      subjects: [id],
    };
  }

  private async resolveWithAuthentication(
    id: string,
    prLinks: string[],
    provider: BacklogAutomationProvider,
  ): Promise<SubjectResolutionAttempt & { subjects: string[] }> {
    // Try to fetch metadata for the first PR link
    // (could be extended to validate all links)
    for (const prLink of prLinks) {
      try {
        const prIdentity = provider.normalizePRReference(prLink);
        if (!prIdentity) {
          continue;
        }

        const metadata = await provider.fetchPRMetadata(prIdentity);

        // Only consider the subject resolved if PR is merged
        // (Phase B validates existence; Phase C may refine the policy)
        if (metadata.merged) {
          return {
            strategy: this.name(),
            subjectsFound: 1,
            subjects: [id],
          };
        }
      } catch (err) {
        // Log but continue to next PR link
        continue;
      }
    }

    return {
      strategy: this.name(),
      subjectsFound: 0,
      subjects: [],
    };
  }

  private extractPrLinksFromFrontmatter(raw: unknown): string[] {
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
        return (links["pull_requests"] as unknown[]).flatMap((v) =>
          typeof v === "string" && v.trim().length > 0 ? [v.trim()] : [],
        );
      }
    }
    return [];
  }
}

/**
 * SubjectResolverChain
 *
 * Executor that chains multiple resolver strategies in configurable order.
 * Returns first successful resolution, or falls back through remaining strategies.
 */
export class SubjectResolverChain {
  private resolvers: Map<SubjectResolverName, SubjectResolver>;

  constructor() {
    this.resolvers = new Map();
    // Register default strategies
    this.register(new PayloadSubjectTokensResolver());
    this.register(new LinkedPullRequestsResolver());
  }

  register(resolver: SubjectResolver): void {
    this.resolvers.set(resolver.name(), resolver);
  }

  async resolveSubjects(
    context: SubjectResolverContext,
    order?: SubjectResolverName[],
  ): Promise<SubjectResolutionResult> {
    const resolverOrder = order ? this.normalizeOrder(order) : Array.from(this.resolvers.keys());
    const attempts: SubjectResolutionAttempt[] = [];

    for (const strategy of resolverOrder) {
      const resolver = this.resolvers.get(strategy);
      if (!resolver) {
        // Skip unknown strategies
        continue;
      }

      try {
        const attempt = await resolver.resolve(context);
        attempts.push({
          strategy: attempt.strategy,
          subjectsFound: attempt.subjectsFound,
          error: attempt.error,
        });

        if (attempt.subjects.length > 0) {
          return {
            subjects: attempt.subjects,
            strategyUsed: strategy,
            attempts,
          };
        }
      } catch (err) {
        // Record error and continue to next strategy
        attempts.push({
          strategy,
          subjectsFound: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      subjects: [],
      strategyUsed: null,
      attempts,
    };
  }

  private normalizeOrder(order: SubjectResolverName[]): SubjectResolverName[] {
    const normalized: SubjectResolverName[] = [];
    for (const name of order) {
      if (this.resolvers.has(name) && !normalized.includes(name)) {
        normalized.push(name);
      }
    }
    return normalized;
  }
}
