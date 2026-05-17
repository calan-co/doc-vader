import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  PayloadSubjectTokensResolver,
  LinkedPullRequestsResolver,
  SubjectResolverChain,
  type SubjectResolverContext,
} from "../lib/backlog/resolver.js";
import type { BacklogAutomationProvider } from "../lib/backlog/provider.js";

describe("SubjectResolvers", () => {
  describe("PayloadSubjectTokensResolver", () => {
    const resolver = new PayloadSubjectTokensResolver();

    it("has correct name", () => {
      expect(resolver.name()).toBe("payload_subject_tokens");
    });

    it("extracts unique work-item tokens from content", async () => {
      const context: SubjectResolverContext = {
        content:
          "# Test\nThis is work-item:feature-1 and work-item:feature-1 again with work-item:feature-2.",
        data: {},
        id: "work-item:test",
        provider: {} as BacklogAutomationProvider,
      };

      const result = await resolver.resolve(context);

      expect(result.strategy).toBe("payload_subject_tokens");
      expect(result.subjectsFound).toBe(2);
      expect(result.subjects).toEqual(["work-item:feature-1", "work-item:feature-2"]);
    });

    it("extracts wi-* tokens alongside work-item tokens", async () => {
      const context: SubjectResolverContext = {
        content:
          "# Test\nTracks WI-228 and work-item:feature-3 plus wi-228 duplicate.",
        data: {},
        id: "work-item:test",
        provider: {} as BacklogAutomationProvider,
      };

      const result = await resolver.resolve(context);

      expect(result.strategy).toBe("payload_subject_tokens");
      expect(result.subjectsFound).toBe(2);
      expect(result.subjects).toEqual(["wi-228", "work-item:feature-3"]);
    });

    it("returns empty array when no tokens found", async () => {
      const context: SubjectResolverContext = {
        content: "# Test\nNo work items here",
        data: {},
        id: "work-item:test",
        provider: {} as BacklogAutomationProvider,
      };

      const result = await resolver.resolve(context);

      expect(result.subjectsFound).toBe(0);
      expect(result.subjects).toEqual([]);
    });
  });

  describe("LinkedPullRequestsResolver", () => {
    const resolver = new LinkedPullRequestsResolver();

    it("has correct name", () => {
      expect(resolver.name()).toBe("linked_pull_requests");
    });

    it("returns empty when no work-item ID", async () => {
      const mockProvider = {
        isAuthenticated: () => true,
      } as BacklogAutomationProvider;

      const context: SubjectResolverContext = {
        content: "# Test",
        data: {},
        id: null,
        provider: mockProvider,
      };

      const result = await resolver.resolve(context);

      expect(result.subjectsFound).toBe(0);
      expect(result.subjects).toEqual([]);
    });

    it("resolves without auth by checking for PR links (Phase A fallback)", async () => {
      const mockProvider = {
        isAuthenticated: () => false,
      } as BacklogAutomationProvider;

      const context: SubjectResolverContext = {
        content: "# Test",
        data: {
          links: [{ pull_request: "https://github.com/owner/repo/pull/123" }],
        },
        id: "work-item:test",
        provider: mockProvider,
      };

      const result = await resolver.resolve(context);

      // Without auth, still resolves by checking PR links (Phase A behavior)
      expect(result.subjectsFound).toBe(1);
      expect(result.subjects).toEqual(["work-item:test"]);
    });

    it("resolves subject when PR is merged", async () => {
      const mockProvider = {
        isAuthenticated: () => true,
        normalizePRReference: (ref: string) => ({
          owner: "owner",
          repo: "repo",
          number: 123,
          reference: ref,
        }),
        fetchPRMetadata: async () => ({
          number: 123,
          title: "Test PR",
          state: "closed" as const,
          merged: true,
          url: "https://github.com/owner/repo/pull/123",
        }),
      } as BacklogAutomationProvider;

      const context: SubjectResolverContext = {
        content: "# Test",
        data: {
          links: [{ pull_request: "https://github.com/owner/repo/pull/123" }],
        },
        id: "work-item:test",
        provider: mockProvider,
      };

      const result = await resolver.resolve(context);

      expect(result.subjectsFound).toBe(1);
      expect(result.subjects).toEqual(["work-item:test"]);
    });

    it("returns empty when PR is not merged", async () => {
      const mockProvider = {
        isAuthenticated: () => true,
        normalizePRReference: (ref: string) => ({
          owner: "owner",
          repo: "repo",
          number: 123,
          reference: ref,
        }),
        fetchPRMetadata: async () => ({
          number: 123,
          title: "Test PR",
          state: "open" as const,
          merged: false,
          url: "https://github.com/owner/repo/pull/123",
        }),
      } as BacklogAutomationProvider;

      const context: SubjectResolverContext = {
        content: "# Test",
        data: {
          links: [{ pull_request: "https://github.com/owner/repo/pull/123" }],
        },
        id: "work-item:test",
        provider: mockProvider,
      };

      const result = await resolver.resolve(context);

      expect(result.subjectsFound).toBe(0);
      expect(result.subjects).toEqual([]);
    });
  });

  describe("SubjectResolverChain", () => {
    it("resolves subjects using first successful strategy", async () => {
      const chain = new SubjectResolverChain();

      const mockProvider = {
        isAuthenticated: () => false,
      } as BacklogAutomationProvider;

      const context: SubjectResolverContext = {
        content: "This mentions work-item:feature-1",
        data: {},
        id: "work-item:test",
        provider: mockProvider,
      };

      const result = await chain.resolveSubjects(context);

      expect(result.strategyUsed).toBe("payload_subject_tokens");
      expect(result.subjects).toEqual(["work-item:feature-1"]);
      expect(result.attempts).toHaveLength(1);
    });

    it("tries next strategy if first fails", async () => {
      const chain = new SubjectResolverChain();

      const mockProvider = {
        isAuthenticated: () => true,
        normalizePRReference: (ref: string) => ({
          owner: "owner",
          repo: "repo",
          number: 123,
          reference: ref,
        }),
        fetchPRMetadata: async () => ({
          number: 123,
          title: "Test PR",
          state: "closed" as const,
          merged: true,
          url: "https://github.com/owner/repo/pull/123",
        }),
      } as BacklogAutomationProvider;

      const context: SubjectResolverContext = {
        content: "No work items in body",
        data: {
          links: [{ pull_request: "https://github.com/owner/repo/pull/123" }],
        },
        id: "work-item:test",
        provider: mockProvider,
      };

      const result = await chain.resolveSubjects(context);

      expect(result.strategyUsed).toBe("linked_pull_requests");
      expect(result.subjects).toEqual(["work-item:test"]);
      expect(result.attempts).toHaveLength(2);
    });

    it("respects custom resolver order", async () => {
      const chain = new SubjectResolverChain();

      const mockProvider = {
        isAuthenticated: () => false,
      } as BacklogAutomationProvider;

      const context: SubjectResolverContext = {
        content: "work-item:feature-1",
        data: {},
        id: "work-item:test",
        provider: mockProvider,
      };

      const result = await chain.resolveSubjects(context, ["payload_subject_tokens"]);

      expect(result.strategyUsed).toBe("payload_subject_tokens");
      expect(result.attempts).toHaveLength(1);
    });

    it("returns empty result when no strategies succeed", async () => {
      const chain = new SubjectResolverChain();

      const mockProvider = {
        isAuthenticated: () => false,
      } as BacklogAutomationProvider;

      const context: SubjectResolverContext = {
        content: "No work items here",
        data: {},
        id: null,
        provider: mockProvider,
      };

      const result = await chain.resolveSubjects(context);

      expect(result.strategyUsed).toBeNull();
      expect(result.subjects).toEqual([]);
      expect(result.attempts).toHaveLength(2); // Both strategies tried
    });
  });
});
